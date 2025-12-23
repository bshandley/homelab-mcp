import { SystemInfo } from '../types.js';
import { promises as fs } from 'fs';
import os from 'os';

export async function getSystemInfo(): Promise<SystemInfo> {
  const hostname = os.hostname();
  const uptimeHours = parseFloat((os.uptime() / 3600).toFixed(2));

  // CPU usage - average over 1 second
  const cpuPercent = await getCPUUsage();

  // Memory
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsedGB = parseFloat((usedMemory / (1024 ** 3)).toFixed(2));
  const memoryTotalGB = parseFloat((totalMemory / (1024 ** 3)).toFixed(2));
  const memoryPercent = parseFloat(((usedMemory / totalMemory) * 100).toFixed(2));

  // Disk usage for root filesystem
  const diskStats = await getDiskUsage('/');

  return {
    hostname,
    uptime_hours: uptimeHours,
    cpu_percent: cpuPercent,
    memory_used_gb: memoryUsedGB,
    memory_total_gb: memoryTotalGB,
    memory_percent: memoryPercent,
    disk_used_gb: diskStats.usedGB,
    disk_total_gb: diskStats.totalGB,
    disk_percent: diskStats.percent,
  };
}

async function getCPUUsage(): Promise<number> {
  const startUsage = getCPUInfo();

  await new Promise(resolve => setTimeout(resolve, 1000));

  const endUsage = getCPUInfo();

  const idleDiff = endUsage.idle - startUsage.idle;
  const totalDiff = endUsage.total - startUsage.total;

  const cpuPercent = 100 - (100 * idleDiff / totalDiff);

  return parseFloat(cpuPercent.toFixed(2));
}

function getCPUInfo() {
  const cpus = os.cpus();

  let idle = 0;
  let total = 0;

  cpus.forEach(cpu => {
    for (const type in cpu.times) {
      total += cpu.times[type as keyof typeof cpu.times];
    }
    idle += cpu.times.idle;
  });

  return { idle, total };
}

async function getDiskUsage(path: string): Promise<{ usedGB: number; totalGB: number; percent: number }> {
  try {
    // Read /proc/mounts to find the device for the path
    const mounts = await fs.readFile('/proc/mounts', 'utf-8');
    const lines = mounts.split('\n');

    // Find the mount point for the path
    let device = '';
    let mountPoint = '';
    let longestMatch = 0;

    for (const line of lines) {
      const parts = line.split(' ');
      if (parts.length < 2) continue;

      const mount = parts[1];
      if (path.startsWith(mount) && mount.length > longestMatch) {
        device = parts[0];
        mountPoint = mount;
        longestMatch = mount.length;
      }
    }

    if (!device) {
      throw new Error('Could not find device for path');
    }

    // Use statvfs-like approach via /proc/self/mountinfo
    const { execSync } = await import('child_process');
    const dfOutput = execSync(`df -B1 ${mountPoint}`).toString();
    const dfLines = dfOutput.split('\n');

    if (dfLines.length < 2) {
      throw new Error('Unexpected df output');
    }

    const stats = dfLines[1].split(/\s+/);
    const totalBytes = parseInt(stats[1], 10);
    const usedBytes = parseInt(stats[2], 10);

    const totalGB = parseFloat((totalBytes / (1024 ** 3)).toFixed(2));
    const usedGB = parseFloat((usedBytes / (1024 ** 3)).toFixed(2));
    const percent = parseFloat(((usedBytes / totalBytes) * 100).toFixed(2));

    return { usedGB, totalGB, percent };
  } catch (error) {
    // Fallback: return dummy data
    console.warn('[System] Could not get disk usage:', (error as Error).message);
    return { usedGB: 0, totalGB: 0, percent: 0 };
  }
}
