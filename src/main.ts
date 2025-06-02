import {
	App,
	EventRef,
	Menu,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";
import "@total-typescript/ts-reset";
import "@total-typescript/ts-reset/dom";
import { PluginSettingManager } from "@/SettingManager";
import { Graph3DView, VIEW_TYPE_GRAPH3D } from "./Graph3DView";

export default class BetterGraph3D extends Plugin {
	settingManager: PluginSettingManager;
	private eventRefs: EventRef[] = [];

	async onload() {
		// Initialize the setting manager
		this.settingManager = new PluginSettingManager(this);

		// Load the setting using setting manager
		await this.settingManager.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Sample Plugin",
			(event: MouseEvent) => {
				const menu = new Menu();

				menu.addItem((item) =>
					item
						.setTitle('Copy')
						.setIcon('documents')
						.onClick(() => {
							new Notice('Copied');
						})
				);

				menu.addItem((item) =>
					item
						.setTitle('Paste')
						.setIcon('paste')
						.onClick(() => {
							new Notice('Pasted');
						})
				);

				menu.showAtMouseEvent(event);

				// Called when the user clicks the icon.
				new Notice("This is a notice!");
			}
		);

		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_GRAPH3D, (leaf) => new Graph3DView(leaf));

		this.addCommand({
			id: "open-3d-graph-view",
			name: "Open 3D Graph View",
			callback: () => {
				const sidebar = this.app.workspace.getRightLeaf(false);

				if (sidebar) {
					sidebar.setViewState({
						type: VIEW_TYPE_GRAPH3D,
						active: true,
					});
				}
			},
		});
	}

	onunload() {
		super.onunload();
		// unload all event ref
		for (const eventRef of this.eventRefs) {
			this.app.workspace.offref(eventRef);
		}
	}
}


class SampleSettingTab extends PluginSettingTab {
	plugin: BetterGraph3D;

	constructor(app: App, plugin: BetterGraph3D) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settingManager.getSettings().test)
					.onChange(async (value) => {
						this.plugin.settingManager.updateSettings((setting) => {
							setting.value.test = value;
						});
					})
			);
	}
}
