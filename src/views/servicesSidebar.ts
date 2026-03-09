import * as vscode from "vscode";
import { ServiceRegistry } from "../services/serviceRegistry";
import { CategoryItem, ServiceItem } from "./treeItems";

export class ServicesTreeProvider implements vscode.TreeDataProvider<CategoryItem | ServiceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<CategoryItem | ServiceItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private registry: ServiceRegistry) {}

  async refresh(): Promise<void> {
    await this.registry.checkStatuses();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: CategoryItem | ServiceItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CategoryItem | ServiceItem): (CategoryItem | ServiceItem)[] {
    if (!element) {
      const categories = this.registry.getCategories();
      const services = this.registry.getServices();
      return categories
        .filter((c) => services.some((s) => s.category === c.id))
        .map((c) => new CategoryItem(c.id, c.label));
    }
    if (element instanceof CategoryItem) {
      return this.registry
        .getServices()
        .filter((s) => s.category === element.categoryId)
        .map((s) => new ServiceItem(s, this.registry.getStatus(s.id)));
    }
    return [];
  }
}
