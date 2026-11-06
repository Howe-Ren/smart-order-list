import type { Plugin } from 'obsidian';
import type { IndentationProfile } from './settings';

const PROFILE1_CLASS = 'smart-list-indent-profile1';
const PROFILE2_CLASS = 'smart-list-indent-profile2';
const LEGACY_PROFILE_CLASSES = ['smart-list-reading-indent-fixed', 'smart-list-reading-indent-custom'];

export function applyIndentationProfile(profile: IndentationProfile): void {
    const body = document.body;
    body.classList.remove(...LEGACY_PROFILE_CLASSES);
    body.classList.toggle(PROFILE1_CLASS, profile === 'profile1');
    body.classList.toggle(PROFILE2_CLASS, profile === 'profile2');
}

/** Apply the saved indentation profile and remove its body class when the plugin unloads. */
export function registerIndentationProfile(plugin: Plugin, profile: IndentationProfile): void {
    applyIndentationProfile(profile);
    plugin.register(() => {
        document.body.classList.remove(PROFILE1_CLASS, PROFILE2_CLASS, ...LEGACY_PROFILE_CLASSES);
    });
}
