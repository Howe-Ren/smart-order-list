export type IndentationProfile = 'profile1' | 'profile2';

export interface SmartOrderListSettings {
    indentationProfile: IndentationProfile;
}

export const DEFAULT_SETTINGS: SmartOrderListSettings = {
    indentationProfile: 'profile1'
};

export function normalizeSettings(data: unknown): SmartOrderListSettings {
    const stored = data && typeof data === 'object'
        ? (data as Partial<SmartOrderListSettings>).indentationProfile
        : undefined;
    return { indentationProfile: stored === 'profile2' ? 'profile2' : 'profile1' };
}
