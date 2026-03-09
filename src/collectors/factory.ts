import { detectPlatform } from "../utils/platform";
import { findBinary } from "../utils/exec";
import { log } from "../utils/logger";
import { ISystemCollector, IGpuCollector, IDockerCollector } from "./interfaces";
import { LinuxSystemCollector } from "./linuxSystem";
import { DarwinSystemCollector } from "./darwinSystem";
import { NvidiaCollector } from "./nvidiaCollector";
import { RocmCollector } from "./rocmCollector";
import { AppleGpuCollector } from "./appleGpuCollector";
import { NullGpuCollector } from "./nullGpuCollector";
import { DockerCollector } from "./dockerCollector";

export interface Collectors {
  system: ISystemCollector;
  gpu: IGpuCollector;
  docker: IDockerCollector;
}

export async function createCollectors(): Promise<Collectors> {
  const platform = detectPlatform();
  log(`Creating collectors for platform: ${platform}`);

  // System collector
  const system: ISystemCollector = platform === "darwin" ? new DarwinSystemCollector() : new LinuxSystemCollector();

  // GPU collector — probe in order: nvidia, rocm, apple, null
  let gpu: IGpuCollector;
  const nvidia = new NvidiaCollector();
  if (await nvidia.isAvailable()) {
    gpu = nvidia;
    log("GPU collector: NVIDIA");
  } else {
    const rocm = new RocmCollector();
    if (await rocm.isAvailable()) {
      gpu = rocm;
      log("GPU collector: ROCm (AMD)");
    } else if (platform === "darwin") {
      const apple = new AppleGpuCollector();
      if (await apple.isAvailable()) {
        gpu = apple;
        log("GPU collector: Apple");
      } else {
        gpu = new NullGpuCollector();
        log("GPU collector: None");
      }
    } else {
      gpu = new NullGpuCollector();
      log("GPU collector: None");
    }
  }

  // Docker collector
  const docker = new DockerCollector();
  const dockerAvailable = await docker.isAvailable();
  log(`Docker available: ${dockerAvailable}`);

  return { system, gpu, docker };
}
