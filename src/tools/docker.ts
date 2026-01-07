import Docker from 'dockerode';
import { Config, ContainerInfo, ContainerStats, DockerVolume, DockerNetwork, OperationResult, ExecResult } from '../types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const MAX_LOG_BYTES = 32000; // 32KB max to prevent context overflow

let docker: Docker;

export function initDocker(config: Config): void {
  docker = new Docker({ socketPath: config.dockerSocket });
}

/**
 * Converts relative time strings to Unix timestamps
 * @param relativeTime - Time string like "30s", "10m", "1h", "2d"
 * @returns Unix timestamp as a string
 */
function convertRelativeTimeToTimestamp(relativeTime: string): string {
  const match = relativeTime.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid time format: ${relativeTime}. Use format like "30s", "10m", "1h", "2d"`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  let seconds = 0;
  switch (unit) {
    case 's':
      seconds = value;
      break;
    case 'm':
      seconds = value * 60;
      break;
    case 'h':
      seconds = value * 60 * 60;
      break;
    case 'd':
      seconds = value * 60 * 60 * 24;
      break;
  }

  const timestamp = Math.floor(Date.now() / 1000) - seconds;
  return timestamp.toString();
}

// Level 1 - Monitor

export async function listContainers(all: boolean = true): Promise<{ containers: ContainerInfo[] }> {
  const containers = await docker.listContainers({ all });

  return {
    containers: (containers || []).map(c => ({
      id: c.Id.substring(0, 12),
      name: c.Names[0]?.replace(/^\//, '') || 'unknown',
      image: c.Image,
      status: c.Status,
      state: c.State as ContainerInfo['state'],
      created: new Date(c.Created * 1000).toISOString(),
      ports: c.Ports.map(p => {
        if (p.PublicPort) {
          return `${p.PublicPort}:${p.PrivatePort}/${p.Type}`;
        }
        return `${p.PrivatePort}/${p.Type}`;
      }),
    })),
  };
}

export async function getContainerLogs(
  container: string,
  lines: number = 50,
  since?: string,
  filter?: string
): Promise<{
  container: string;
  logs: string;
  metadata: {
    lines_requested: number;
    lines_returned: number;
    truncated: boolean;
    truncated_bytes?: number;
    hint?: string;
  }
}> {
  const c = docker.getContainer(container);

  const requestedLines = Math.min(lines, 500);
  const options: Docker.ContainerLogsOptions & { follow?: false } = {
    stdout: true,
    stderr: true,
    tail: requestedLines,
    follow: false,
  };

  if (since) {
    options.since = convertRelativeTimeToTimestamp(since);
  }

  const logs = await c.logs(options);
  let logString = (logs as Buffer).toString('utf-8');

  // Apply regex filter if provided
  if (filter) {
    try {
      const regex = new RegExp(filter, 'i');
      const lines = logString.split('\n');
      logString = lines.filter(line => regex.test(line)).join('\n');
    } catch (error) {
      // Invalid regex, skip filtering
    }
  }

  // Check if we need to truncate by bytes
  let truncated = false;
  let truncatedBytes = 0;
  let actualLines = logString.split('\n').length;

  if (logString.length > MAX_LOG_BYTES) {
    truncated = true;
    truncatedBytes = logString.length - MAX_LOG_BYTES;

    // Keep the END of logs (most recent) by truncating from the start
    logString = logString.slice(-MAX_LOG_BYTES);

    // Find the first complete line after truncation
    const firstNewline = logString.indexOf('\n');
    if (firstNewline !== -1) {
      logString = logString.slice(firstNewline + 1);
    }

    // Prepend truncation notice
    logString = `... [truncated ${truncatedBytes} bytes from start] ...\n\n` + logString;

    actualLines = logString.split('\n').length;
  }

  const metadata: {
    lines_requested: number;
    lines_returned: number;
    truncated: boolean;
    truncated_bytes?: number;
    hint?: string;
  } = {
    lines_requested: lines,
    lines_returned: actualLines,
    truncated,
  };

  if (truncated) {
    metadata.truncated_bytes = truncatedBytes;
    metadata.hint = 'Output was truncated. Try using "since" parameter (e.g., "5m", "1h") or "filter" parameter (regex) to narrow results.';
  }

  return {
    container,
    logs: logString,
    metadata,
  };
}

export async function getContainerStats(container: string): Promise<ContainerStats> {
  const c = docker.getContainer(container);

  const stats = await c.stats({ stream: false });

  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - (stats.precpu_stats.cpu_usage?.total_usage || 0);
  const systemDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage || 0);
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;

  const memoryUsageMB = stats.memory_stats.usage / (1024 * 1024);
  const memoryLimitMB = stats.memory_stats.limit / (1024 * 1024);
  const memoryPercent = (stats.memory_stats.usage / stats.memory_stats.limit) * 100;

  let networkRxMB = 0;
  let networkTxMB = 0;
  if (stats.networks) {
    for (const net of Object.values(stats.networks)) {
      networkRxMB += net.rx_bytes / (1024 * 1024);
      networkTxMB += net.tx_bytes / (1024 * 1024);
    }
  }

  return {
    container,
    cpu_percent: parseFloat(cpuPercent.toFixed(2)),
    memory_usage_mb: parseFloat(memoryUsageMB.toFixed(2)),
    memory_limit_mb: parseFloat(memoryLimitMB.toFixed(2)),
    memory_percent: parseFloat(memoryPercent.toFixed(2)),
    network_rx_mb: parseFloat(networkRxMB.toFixed(2)),
    network_tx_mb: parseFloat(networkTxMB.toFixed(2)),
  };
}

// Level 2 - Operate

export async function restartContainer(container: string): Promise<OperationResult & { container: string }> {
  try {
    const c = docker.getContainer(container);
    await c.restart();
    return {
      success: true,
      container,
      message: `Container ${container} restarted successfully`,
    };
  } catch (error) {
    return {
      success: false,
      container,
      message: `Failed to restart container: ${(error as Error).message}`,
    };
  }
}

export async function startContainer(container: string): Promise<OperationResult & { container: string }> {
  try {
    const c = docker.getContainer(container);
    await c.start();
    return {
      success: true,
      container,
      message: `Container ${container} started successfully`,
    };
  } catch (error) {
    return {
      success: false,
      container,
      message: `Failed to start container: ${(error as Error).message}`,
    };
  }
}

export async function stopContainer(container: string, timeout: number = 10): Promise<OperationResult & { container: string }> {
  try {
    const c = docker.getContainer(container);
    await c.stop({ t: timeout });
    return {
      success: true,
      container,
      message: `Container ${container} stopped successfully`,
    };
  } catch (error) {
    return {
      success: false,
      container,
      message: `Failed to stop container: ${(error as Error).message}`,
    };
  }
}

// Level 3 - Configure

export async function readComposeFile(stack: string, config: Config): Promise<{ stack: string; compose: string }> {
  const composePath = join(config.dockgeStacksPath, stack, 'compose.yaml');

  try {
    const compose = await fs.readFile(composePath, 'utf-8');
    return { stack, compose };
  } catch (error) {
    // Try docker-compose.yml as fallback
    try {
      const composePathAlt = join(config.dockgeStacksPath, stack, 'docker-compose.yml');
      const compose = await fs.readFile(composePathAlt, 'utf-8');
      return { stack, compose };
    } catch {
      throw new Error(`Compose file not found for stack: ${stack}`);
    }
  }
}

export async function readEnvFile(stack: string, config: Config): Promise<{ stack: string; env: string }> {
  const envPath = join(config.dockgeStacksPath, stack, '.env');

  try {
    const env = await fs.readFile(envPath, 'utf-8');
    return { stack, env };
  } catch (error) {
    throw new Error(`.env file not found for stack: ${stack}`);
  }
}

export async function listVolumes(): Promise<{ volumes: DockerVolume[] }> {
  const result = await docker.listVolumes();

  return {
    volumes: (result.Volumes || []).map(v => ({
      name: v.Name,
      driver: v.Driver,
      mountpoint: v.Mountpoint,
    })),
  };
}

export async function listNetworks(): Promise<{ networks: DockerNetwork[] }> {
  const networks = await docker.listNetworks();

  return {
    networks: (networks || []).map(n => ({
      name: n.Name,
      driver: n.Driver,
      scope: n.Scope,
    })),
  };
}

export async function inspectContainer(container: string): Promise<{ container: string; config: any }> {
  const c = docker.getContainer(container);
  const info = await c.inspect();

  return {
    container,
    config: info,
  };
}

// Level 4 - Manage

export async function writeComposeFile(
  stack: string,
  compose: string,
  config: Config
): Promise<OperationResult & { stack: string }> {
  try {
    const stackDir = join(config.dockgeStacksPath, stack);
    const composePath = join(stackDir, 'compose.yaml');

    // Ensure directory exists
    await fs.mkdir(stackDir, { recursive: true });

    // Write compose file
    await fs.writeFile(composePath, compose, 'utf-8');

    return {
      success: true,
      stack,
      message: `Compose file written successfully for stack: ${stack}`,
    };
  } catch (error) {
    return {
      success: false,
      stack,
      message: `Failed to write compose file: ${(error as Error).message}`,
    };
  }
}

export async function composeUp(stack: string, config: Config): Promise<OperationResult & { stack: string }> {
  try {
    const stackDir = join(config.dockgeStacksPath, stack);
    const { stdout, stderr } = await execAsync('docker compose up -d', { cwd: stackDir });

    return {
      success: true,
      stack,
      message: `Stack ${stack} deployed successfully\n${stdout}${stderr}`,
    };
  } catch (error) {
    return {
      success: false,
      stack,
      message: `Failed to deploy stack: ${(error as Error).message}`,
    };
  }
}

export async function composeDown(
  stack: string,
  removeVolumes: boolean = false,
  config: Config
): Promise<OperationResult & { stack: string }> {
  try {
    const stackDir = join(config.dockgeStacksPath, stack);
    const cmd = removeVolumes ? 'docker compose down -v' : 'docker compose down';
    const { stdout, stderr } = await execAsync(cmd, { cwd: stackDir });

    return {
      success: true,
      stack,
      message: `Stack ${stack} torn down successfully\n${stdout}${stderr}`,
    };
  } catch (error) {
    return {
      success: false,
      stack,
      message: `Failed to tear down stack: ${(error as Error).message}`,
    };
  }
}

export async function execInContainer(
  container: string,
  command: string,
  timeout: number = 30
): Promise<ExecResult> {
  const c = docker.getContainer(container);

  const exec = await c.exec({
    Cmd: ['/bin/sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeout} seconds`));
    }, timeout * 1000);

    exec.start({ Detach: false, Tty: false }, (err, stream) => {
      if (err) {
        clearTimeout(timeoutId);
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';

      stream!.on('data', (chunk: Buffer) => {
        const str = chunk.toString();
        // Docker multiplexes stdout/stderr with an 8-byte header
        // Header format: [stream_type, 0, 0, 0, size1, size2, size3, size4]
        if (chunk[0] === 1) {
          stdout += str.substring(8);
        } else if (chunk[0] === 2) {
          stderr += str.substring(8);
        }
      });

      stream!.on('end', async () => {
        clearTimeout(timeoutId);
        const inspectData = await exec.inspect();
        resolve({
          container,
          command,
          exit_code: inspectData.ExitCode || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
  });
}
