import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Agent as HttpsAgent } from 'node:https';
import { defineConfig, loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

const publicShell = ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable.png'];
function appShell(): Plugin {
  return {
    name: 'tala-public-shell',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const worker = readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
      const entries = Object.keys(bundle).filter(name => name.startsWith('assets/')).sort();
      const hash = createHash('sha256').update(worker).update(entries.join('\n'));
      for (const file of publicShell) hash.update(readFileSync(new URL('./public/'+file, import.meta.url)));
      hash.update(String(bundle['index.html']?.type==='asset' ? bundle['index.html'].source : ''));
      this.emitFile({type:'asset',fileName:'sw.js',source:
        'const shellCache = '+JSON.stringify('tala-shell-'+hash.digest('hex').slice(0,16))+';\n'+
        'const shellUrls = '+JSON.stringify(['index.html',...publicShell,...entries].map(name=>'/'+name))+';\n'+worker});
    },
  };
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode,process.cwd(),'');
  const { WEB_DEV_CERT, WEB_DEV_KEY, WEB_DEV_API, WEB_DEV_CA } = env;
  const target = WEB_DEV_API || 'http://127.0.0.1:8788';
  const https = WEB_DEV_CERT && WEB_DEV_KEY ? {cert: readFileSync(WEB_DEV_CERT),key:readFileSync(WEB_DEV_KEY)} : undefined;
  const agent = WEB_DEV_CA && target.startsWith('https://') ? new HttpsAgent({ca:readFileSync(WEB_DEV_CA)}) : undefined;
  if (Boolean(WEB_DEV_CERT)!==Boolean(WEB_DEV_KEY)) throw new Error('Set both WEB_DEV_CERT and WEB_DEV_KEY for HTTPS development.');
  return {
    plugins:[tailwindcss(),appShell()],
    server:{host:'localhost',port:5173,strictPort:true,https,proxy:{
      '/api':{target,agent,
        configure(proxy){proxy.on('proxyReq',(request,incoming)=>{
          request.removeHeader('X-Forwarded-For');
          request.removeHeader('X-Forwarded-Host');
          request.setHeader('X-Forwarded-Proto',https ? 'https' : 'http');
        });},
      },
    }},
  };
});
