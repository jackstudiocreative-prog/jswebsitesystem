import {pathToFileURL} from 'node:url';
export const allowPreview=env=>env.VERCEL_ENV==='preview'&&env.VERCEL_GIT_COMMIT_REF==='staging';
// Vercel ignored-build convention: 0 skips, 1 builds.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exit(allowPreview(process.env)?1:0);
