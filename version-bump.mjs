import { readFileSync, writeFileSync } from "fs";

// 1. Get the new version number from the npm environment
const targetVersion = process.env.npm_package_version;

// 2. update manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
// auto-populate minAppVersion from manifest.json and update target version
const { minAppVersion } = manifest;
manifest.version = targetVersion;
// write back to manifest.json
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// 3. update versions.json with target version and minAppVersion from manifest.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
// update by checking the absent relevant minAppversion
if (!versions.hasOwnProperty(targetVersion)) {
    versions[targetVersion] = minAppVersion;
    writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));
    console.log(`Successfully bumped versions.json to ${targetVersion}`);
}