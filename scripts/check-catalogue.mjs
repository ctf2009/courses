import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const catalogue = JSON.parse(await readFile(path.join(root, 'curation/catalogue.json'), 'utf8'));
const errors = [];
const ids = new Set();
const paths = new Set();
const keys = new Set();

async function checkFile(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) {
    throw new Error('Expected a repository-relative path');
  }
  const resolved = await realpath(path.resolve(root, relative));
  const fromRoot = path.relative(root, resolved);
  if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error(`Path leaves repository: ${relative}`);
  }
  return readFile(resolved, 'utf8');
}

if (catalogue.schemaVersion !== 1 || !Array.isArray(catalogue.courses)) {
  throw new Error('Expected catalogue schemaVersion 1 and courses array');
}
for (const course of catalogue.courses) {
  try {
    for (const field of ['id', 'title', 'path', 'audience', 'objective', 'progressKey']) {
      if (typeof course[field] !== 'string' || !course[field].trim()) throw new Error(`Missing ${field}`);
    }
    for (const [field, seen] of [['id', ids], ['path', paths], ['progressKey', keys]]) {
      if (seen.has(course[field])) throw new Error(`Duplicate ${field}: ${course[field]}`);
      seen.add(course[field]);
    }
    const directory = { served: 'public', draft: 'drafts' }[course.placement];
    if (!directory || !new RegExp(`^${directory}/[a-z0-9-]+-course\\.html$`).test(course.path)) {
      throw new Error('Placement and course path disagree');
    }
    if (!['not-reviewed', 'changes-needed', 'reviewed'].includes(course.reviewStatus)) {
      throw new Error('Unknown reviewStatus');
    }
    if (course.reviewStatus !== 'not-reviewed' && !course.review) throw new Error('Review record required');
    const html = await checkFile(course.path);
    if (!html.includes(course.progressKey)) throw new Error('Progress key absent from course source');
    if (course.review) await checkFile(course.review);
    if (course.reviewEvidence) await checkFile(course.reviewEvidence);
  } catch (error) {
    errors.push(`${course?.id ?? 'unnamed'}: ${error.message}`);
  }
}
for (const directory of ['public', 'drafts']) {
  for (const file of await readdir(path.join(root, directory))) {
    if (file.endsWith('-course.html') && !paths.has(`${directory}/${file}`)) {
      errors.push(`Uncatalogued course: ${directory}/${file}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Catalogue valid: ${catalogue.courses.length} courses. Content and browser review are separate.`);
}
