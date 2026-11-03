import fs from 'node:fs/promises';
import { fetchSnapshot } from '../server/content.js';
const snapshot = await fetchSnapshot();
await fs.writeFile('fixtures/spooky-doll.json', JSON.stringify(snapshot, null, 2));
console.log(`Saved public API snapshot: ${snapshot.manifest.chapters.length} episodes, ${Object.keys(snapshot.subtitles).length} subtitle files; ${snapshot.fetchedAt}`);
