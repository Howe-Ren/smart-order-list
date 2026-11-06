import { App, PluginSettingTab, Setting } from 'obsidian';
import type SmartOrderListPlugin from './main';
import { applyIndentationProfile } from './reading-indentation';

export class SmartOrderListSettingTab extends PluginSettingTab {
    constructor(app: App, private readonly smartPlugin: SmartOrderListPlugin) {
        super(app, smartPlugin);
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        const document = containerEl.ownerDocument;
        const description = document.createDocumentFragment();
        const profile1 = document.createElement('strong');
        const profile2 = document.createElement('strong');
        const dynamic = document.createElement('strong');
        profile1.className = 'smart-list-setting-profile-name';
        profile2.className = 'smart-list-setting-profile-name';
        profile1.textContent = 'Profile 1';
        profile2.textContent = 'Profile 2';
        dynamic.append('dynamic');
        description.append(
            profile1,
            ' (default): fixed Live Preview, fixed Reading view.',
            document.createElement('br'),
            profile2,
            ': fixed Live Preview, ',
            dynamic,
            ' Reading view (adjusts to parent prefixes).'
        );

        new Setting(containerEl)
            .setClass('smart-list-indentation-setting')
            // The setting title uses the capitalization requested by the user.
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setName('Indentation Profile')
            .setDesc(description)
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
