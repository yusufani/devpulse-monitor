import * as vscode from "vscode";
import { readFile } from "fs/promises";
import * as path from "path";
import { ServiceDefinition, ServiceCategory, ServiceStatus } from "../types";
import { execCommand } from "../utils/exec";
import { findBinary } from "../utils/exec";
import { log } from "../utils/logger";

export class ServiceRegistry {
  private services: ServiceDefinition[] = [];
  private categories: ServiceCategory[] = [];
  private statuses = new Map<string, ServiceStatus>();

  async load(): Promise<void> {
    const config = vscode.workspace.getConfiguration("dockerMonitor");
    const configPath = config.get<string>("servicesConfigPath", ".vscode/docker-services.json");
    const autoDiscover = config.get<boolean>("autoDiscoverServices", true);

    this.services = [];
    this.categories = [];

    // 1. Load from config file
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsRoot) {
      const fullPath = path.join(wsRoot, configPath);
      try {
        const content = await readFile(fullPath, "utf-8");
        const data = JSON.parse(content);
        if (Array.isArray(data.categories)) {
          this.categories = data.categories;
        }
        if (Array.isArray(data.services)) {
          this.services = data.services;
        }
        log(`Loaded ${this.services.length} services from ${configPath}`);
      } catch {
        // No config file — that's fine
      }

      // 2. Auto-discover docker-compose files
      if (autoDiscover && this.services.length === 0) {
        await this.autoDiscover(wsRoot);
      }
    }

    // 3. Load from VS Code settings as fallback
    const settingsServices = config.get<ServiceDefinition[]>("services", []);
    if (settingsServices.length > 0 && this.services.length === 0) {
      this.services = settingsServices;
    }

    // Set default categories if none loaded
    if (this.categories.length === 0 && this.services.length > 0) {
      const catIds = new Set(this.services.map((s) => s.category).filter(Boolean));
      let order = 0;
      for (const id of catIds) {
        this.categories.push({ id: id!, label: id!.toUpperCase(), sortOrder: order++ });
      }
    }
  }

  private async autoDiscover(wsRoot: string): Promise<void> {
    try {
      const files = await vscode.workspace.findFiles("**/docker-compose*.{yml,yaml}", "**/node_modules/**", 20);
      for (const file of files) {
        try {
          const content = await readFile(file.fsPath, "utf-8");
          // Simple regex to extract service names from compose files
          const serviceMatch = content.match(/^services:\s*\n((?:\s+\w[\w-]*:\s*\n(?:\s+.*\n)*)*)/m);
          if (serviceMatch) {
            const serviceBlock = serviceMatch[1];
            const names = [...serviceBlock.matchAll(/^\s{2}([\w][\w-]*):\s*$/gm)].map((m) => m[1]);
            const relPath = path.relative(wsRoot, file.fsPath);
            for (const name of names) {
              if (!this.services.some((s) => s.composeName === name)) {
                this.services.push({
                  id: `auto_${name}`,
                  label: name,
                  category: "discovered",
                  composeName: name,
                  description: `from ${relPath}`,
                });
              }
            }
          }
        } catch {
          // skip unparseable files
        }
      }

      if (this.services.length > 0) {
        if (!this.categories.some((c) => c.id === "discovered")) {
          this.categories.push({ id: "discovered", label: "DISCOVERED", sortOrder: 99 });
        }
        log(`Auto-discovered ${this.services.length} services`);
      }
    } catch (e) {
      log(`Service auto-discovery failed: ${e}`);
    }
  }

  async checkStatuses(): Promise<Map<string, ServiceStatus>> {
    const result = new Map<string, ServiceStatus>();
    const docker = await findBinary("docker");
    if (!docker) {
      for (const svc of this.services) result.set(svc.id, "stopped");
      return result;
    }

    try {
      const [composeOut, namesOut] = await Promise.all([
        execCommand(`${docker} ps --filter "status=running" --format '{{.Label "com.docker.compose.service"}}'`),
        execCommand(`${docker} ps --format "{{.Names}}"`),
      ]);

      const runningServices = new Set(
        composeOut.stdout
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      );

      const runningNames = namesOut.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const svc of this.services) {
        const dockerSvc = svc.dockerService || svc.composeName || "";
        if (!dockerSvc || svc.category === "action") continue;

        if (dockerSvc.startsWith("__")) {
          // Special service checks
          if (dockerSvc === "__model_manager") {
            result.set(svc.id, runningNames.some((n) => /^(llm|embedding|reranker)-/.test(n)) ? "running" : "stopped");
          } else {
            result.set(svc.id, "stopped");
          }
        } else if (runningServices.has(dockerSvc) || runningNames.some((n) => n === dockerSvc || n.includes(dockerSvc))) {
          result.set(svc.id, "running");
        } else {
          result.set(svc.id, "stopped");
        }
      }
    } catch {
      for (const svc of this.services) {
        if (svc.dockerService || svc.composeName) result.set(svc.id, "stopped");
      }
    }

    this.statuses = result;
    return result;
  }

  getServices(): ServiceDefinition[] {
    return this.services;
  }

  getCategories(): ServiceCategory[] {
    return [...this.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  getStatus(serviceId: string): ServiceStatus | undefined {
    return this.statuses.get(serviceId);
  }

  hasServices(): boolean {
    return this.services.length > 0;
  }
}
