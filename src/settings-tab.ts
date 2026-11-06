import { App, PluginSettingTab, Setting } from 'obsidian';
import type SmartOrderListPlugin from './main';
import { applyIndentationProfile } from './reading-indentation';

const INDENTATION_PROFILE_NAME = 'Indentation Profile';
const INDENTATION_PROFILE_SEARCH_DESCRIPTION =
    'Profile 1: fixed Live Preview and Reading view. Profile 2: fixed Live Preview and dynamic Reading view.';

export class SmartOrderListSettingTab extends PluginSettingTab {
    constructor(app: App, private readonly smartPlugin: SmartOrderListPlugin) {
        super(app, smartPlugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.renderIndentationSetting(new Setting(containerEl).setName(INDENTATION_PROFILE_NAME));
    }

    // Obsidian 1.13+ indexes these definitions for the global settings search.
    // Older versions ignore this method and continue to use display().
    getSettingDefinitions(): { name: string; desc: string; render: (setting: Setting) => void }[] {
        return [{
            name: INDENTATION_PROFILE_NAME,
            desc: INDENTATION_PROFILE_SEARCH_DESCRIPTION,
            render: setting => this.renderIndentationSetting(setting)
        }];
    }

    private renderIndentationSetting(setting: Setting): void {
        setting.setDesc('');
        const description = setting.descEl;
        const profile1 = description.createEl('strong');
        profile1.className = 'smart-list-setting-profile-name';
        profile1.textContent = 'Profile 1';
        description.append(' (default): fixed Live Preview, fixed Reading view.');
        description.createEl('br');
        const profile2 = description.createEl('strong');
        profile2.className = 'smart-list-setting-profile-name';
        profile2.textContent = 'Profile 2';
        description.append(': fixed Live Preview, ');
        description.createEl('strong').append('dynamic');
        description.append(' Reading view (adjusts to parent prefixes).');

        setting
            .setClass('smart-list-indentation-setting')
            .addDropdown(dropdown => {
                dropdown.addOption('profile1', 'Profile 1 (default): fixed');
                dropdown.addOption('profile2', 'Profile 2: dynamic');
                dropdown.setValue(this.smartPlugin.settings.indentationProfile);
                dropdown.onChange(async value => {
                    const profile = value === 'profile2' ? 'profile2' : 'profile1';
                    this.smartPlugin.settings.indentationProfile = profile;
                    applyIndentationProfile(profile);
                    await this.smartPlugin.saveData(this.smartPlugin.settings);
                });
            });
    }
}
