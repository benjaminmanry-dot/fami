import * as fs from 'node:fs';
import {resolve, dirname} from 'node:path';

export const subscriptionProvider = Object.freeze({
  baseUrl: 'https://chatgpt.com/backend-api/codex',
  api: 'openai-chatgpt-responses', auth: 'oauth', models: [],
});
const configPath='/home/fami/.openclaw-fami/openclaw.json';
const imageRoots=['/home/fami/.openclaw-fami/media/tool-image-generation',
  '/home/fami/.openclaw-fami/media/inbound'];

// Check configuration, never read or return the credential store. Pinning the
// endpoint prevents even a native auth-resolution failure from reaching the
// separately billed OpenAI Images API. Unexpected provider changes fail closed.
export function prepareImage(params, io=fs, env=process.env) {
  const cfg=JSON.parse(io.readFileSync(configPath,'utf8'));
  const provider=cfg.models?.providers?.openai;
  if(!provider || Object.keys(provider).sort().join(',')!=='api,auth,baseUrl,models' ||
    provider.baseUrl!==subscriptionProvider.baseUrl || provider.api!==subscriptionProvider.api ||
    provider.auth!=='oauth' || !Array.isArray(provider.models) || provider.models.length)
    throw new Error('Subscription-only image route changed; return to Codex HQ. Paid fallback is forbidden.');
  if(env.OPENAI_API_KEY || env.OPENAI_IMAGE_API_KEY || cfg.env?.OPENAI_API_KEY || cfg.env?.vars?.OPENAI_API_KEY)
    throw new Error('Unexpected API-key environment; image generation blocked, not billed.');
  const p={...params};
  p.action??='generate';
  if(p.action==='status' || p.action==='list') return {action:p.action};
  if(p.action!=='generate') throw new Error('Unknown image action');
  if(p.model && p.model!=='openai/gpt-image-2') throw new Error('Only subscription-backed openai/gpt-image-2 is admitted');
  if(typeof p.prompt!=='string' || !p.prompt.trim()) throw new Error('An image prompt is required');
  if(p.background==='transparent' || p.openai?.background==='transparent')
    throw new Error('Transparent output would change models; this route is qualified only for gpt-image-2.');
  // Native schemas can populate every provider's benign defaults. Rendering
  // hints cannot select an endpoint or credential; distinguish them from routing.
  if(p.openai) {
    if(Object.keys(p.openai).some(k=>!['background','moderation','outputCompression','user'].includes(k)) || p.openai.user)
      throw new Error('Unrecognized OpenAI override or user identifier');
    if(p.openai.background && !['opaque','auto'].includes(p.openai.background)) throw new Error('Invalid background');
    if(p.openai.moderation && p.openai.moderation!=='auto') throw new Error('Use default moderation');
    if(p.openai.outputCompression!==undefined && (!Number.isInteger(p.openai.outputCompression) || p.openai.outputCompression<0 || p.openai.outputCompression>100))
      throw new Error('Invalid image compression');
    p.openai={...p.openai};delete p.openai.user;
  }
  delete p.fal; // Unused on the pinned OpenAI provider, including schema defaults.
  if(p.count!==undefined && (!Number.isInteger(p.count) || p.count<1 || p.count>4)) throw new Error('Count must be one to four');
  if(p.filename && (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(p.filename) || p.filename.includes('..')))
    throw new Error('Use a filename, not an output path');
  const refs=[...(p.image?[p.image]:[]),...(p.images??[])];
  if(refs.length>5) throw new Error('At most five image references');
  for(const file of refs) {
    if(typeof file!=='string' || !file.startsWith('/') || resolve(file)!==file || !/\.(png|jpe?g|webp)$/i.test(file))
      throw new Error('Use a generated or explicitly attached local image; remote URLs and arbitrary files are not admitted');
    const parent=dirname(file);
    if(!imageRoots.includes(parent) || io.realpathSync(parent)!==parent || io.realpathSync(file)!==file || !io.statSync(file).isFile())
      throw new Error('Image reference is outside the admitted media folders or redirects');
  }
  p.model='openai/gpt-image-2'; // Per-call override disables provider fallbacks.
  p.count??=1;
  p.timeoutMs=Math.min(Math.max(Number(p.timeoutMs)||180000,1000),600000);
  return p;
}
