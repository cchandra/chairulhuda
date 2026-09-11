import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

test('public routes, membership isolation, uploads, editorial approval and persistence',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'chairulhuda-test-'));
  const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const base=`http://127.0.0.1:${port}`;
  const gate='Basic '+Buffer.from(':preview-test-password').toString('base64');
  let child;
  let log='';
  const launch=async()=>{
    child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'test',DATA_DIR:dir,PORT:String(port),BASE_URL:base,ADMIN_EMAIL:'editor@example.test',ADMIN_PASSWORD:'Secure-editor-2026!',SITE_PASSWORD:'preview-test-password'}});
    child.stderr.on('data',d=>log+=d.toString());
    for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,50));}
    throw new Error('Server did not start: '+log);
  };
  const stop=async()=>{if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}};
  t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  await launch();
  assert.equal((await fetch(base+'/')).status,401);
  const get=(path,cookie='')=>fetch(base+path,{headers:{Authorization:gate,...(cookie?{Cookie:cookie}:{})},redirect:'manual'});
  const post=(path,data,cookie='',origin=base)=>fetch(base+path,{method:'POST',headers:{Authorization:gate,Origin:origin,...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(data),redirect:'manual'});
  let admin,member,premiumSlug;
  await t.test('all public pages render, search and 404 work',async()=>{
    for(const path of ['/','/karya','/tentang','/pustaka','/kelas','/profesional','/layanan','/privasi','/masuk','/daftar']){
      const res=await get(path);assert.equal(res.status,200,path);const html=await res.text();assert.match(html,/<!doctype html>/i);assert.doesNotMatch(html,/ReferenceError|TypeError/);
    }
    assert.match(await (await get('/pustaka?q=pertanggungjawaban')).text(),/Menata riset/);
    assert.match(await (await get('/karya')).text(),/Pola Pemberatan Pidana/);
    assert.match(await (await get('/pustaka?q=zzzzzz')).text(),/Belum ada hasil/);
    assert.equal((await get('/tidak-ada')).status,404);
    assert.equal((await get('/library.webp')).status,200);
    assert.equal((await get('/admin')).status,302);
    assert.match(await (await get('/sitemap.xml')).text(),/membaca-hukum-pidana/);
  });
  await t.test('accounts are isolated and non-admin cannot enter admin',async()=>{
    const res=await post('/daftar',{name:'Anggota Kedua',email:'member@example.test',password:'Secure-member-2026!',consent:'yes'});
    assert.equal(res.status,302);member=res.headers.get('set-cookie').split(';')[0];
    const html=await (await get('/akun',member)).text();assert.match(html,/Anggota Kedua/);assert.doesNotMatch(html,/Administrator/);
    assert.equal((await get('/admin',member)).status,403);
    assert.equal((await post('/permintaan',{type:'Profesional'},member,'https://attacker.invalid')).status,403);
    assert.equal((await post('/daftar',{name:'x',email:'no',password:'short'})).status,400);
  });
  await t.test('admin login and editor render',async()=>{
    const res=await post('/masuk',{email:'editor@example.test',password:'Secure-editor-2026!'});assert.equal(res.status,302);admin=res.headers.get('set-cookie').split(';')[0];
    assert.equal((await get('/admin',admin)).status,200);
    assert.equal((await get('/admin/materi/baru',admin)).status,200);
    assert.equal((await get('/admin/materi/1',admin)).status,200);
  });
  const upload=async(data)=>{
    const form=new FormData();Object.entries(data).forEach(([k,v])=>form.set(k,v));
    form.set('attachment',new Blob(['%PDF-1.4\nPrivate test document'],{type:'application/pdf'}),'private.pdf');
    return fetch(base+'/admin/materi',{method:'POST',headers:{Authorization:gate,Origin:base,Cookie:admin},body:form,redirect:'manual'});
  };
  const material={title:'Premium test material',summary:'Ringkasan publik',body:'UNIQUE_PRIVATE_CONTENT_1287',topic:'Pidana Korporasi',kind:'Makalah',access:'premium',status:'published',author:'Tim Editorial'};
  await t.test('publishing requires review and premium content cannot leak',async()=>{
    assert.equal((await upload(material)).status,400);
    assert.equal((await upload({...material,reviewed:'yes'})).status,302);
    const list=await (await get('/pustaka')).text();premiumSlug=list.match(/href="\/pustaka\/(premium-test-material-[^"]+)"/)[1];
    assert.doesNotMatch(list,/UNIQUE_PRIVATE_CONTENT_1287/);
    const locked=await (await get('/pustaka/'+premiumSlug,member)).text();assert.match(locked,/Lanjutkan pendalaman/);assert.doesNotMatch(locked,/UNIQUE_PRIVATE_CONTENT_1287/);
    assert.equal((await get('/unduh/4',member)).status,403);
    assert.match(await (await get('/pustaka/'+premiumSlug,admin)).text(),/UNIQUE_PRIVATE_CONTENT_1287/);
    assert.equal((await get('/unduh/4',admin)).status,200);
    assert.equal((await get('/uploads/private.pdf')).status,404);
  });
  await t.test('activation grants and expiry revokes both text and downloads',async()=>{
    assert.equal((await post('/admin/anggota/2',{until:'2099-12-31'},admin)).status,302);
    assert.match(await (await get('/pustaka/'+premiumSlug,member)).text(),/UNIQUE_PRIVATE_CONTENT_1287/);
    assert.equal((await get('/unduh/4',member)).status,200);
    await post('/admin/anggota/2',{until:'2020-01-01'},admin);
    assert.doesNotMatch(await (await get('/pustaka/'+premiumSlug,member)).text(),/UNIQUE_PRIVATE_CONTENT_1287/);
    assert.equal((await get('/unduh/4',member)).status,403);
  });
  await t.test('private video streams support seeking and reject expired members',async()=>{
    const form=new FormData();Object.entries({...material,title:'Kelas video uji',kind:'Kelas',reviewed:'yes'}).forEach(([k,v])=>form.set(k,v));
    form.set('attachment',new Blob([Buffer.from([0,0,0,24]),'ftypisom00000000'],{type:'video/mp4'}),'lesson.mp4');
    assert.equal((await fetch(base+'/admin/materi',{method:'POST',headers:{Authorization:gate,Origin:base,Cookie:admin},body:form,redirect:'manual'})).status,302);
    assert.equal((await get('/media/5',member)).status,403);
    const stream=await fetch(base+'/media/5',{headers:{Authorization:gate,Cookie:admin,Range:'bytes=0-7'}});
    assert.equal(stream.status,206);assert.equal((await stream.arrayBuffer()).byteLength,8);
    const invalid=new FormData();Object.entries({...material,reviewed:'yes'}).forEach(([k,v])=>invalid.set(k,v));
    invalid.set('attachment',new Blob(['<html>not a document</html>'],{type:'application/pdf'}),'invalid.pdf');
    assert.equal((await fetch(base+'/admin/materi',{method:'POST',headers:{Authorization:gate,Origin:base,Cookie:admin},body:invalid,redirect:'manual'})).status,400);
  });
  await t.test('bookmarks and inquiries persist and output is escaped',async()=>{
    await post('/simpan/1',{},member);
    const res=await post('/permintaan',{type:'Profesional',name:'Anggota Kedua',email:'member@example.test',message:'Saya ingin akses profesional <script>alert(1)</script>',consent:'yes'},member);
    assert.equal(res.status,200);assert.match(await res.text(),/permintaan Anda tersimpan/);
    const account=await (await get('/akun',member)).text();assert.match(account,/Dari mana mulai/);assert.match(account,/&lt;script&gt;/);assert.doesNotMatch(account,/<script>alert/);
    assert.match(await (await get('/admin',admin)).text(),/Saya ingin akses profesional/);
    await stop();await launch();
    const persisted=await (await get('/akun',member)).text();assert.match(persisted,/Dari mana mulai/);assert.match(persisted,/Saya ingin akses profesional/);
  });
  await t.test('changing password revokes previous session',async()=>{
    assert.equal((await post('/akun/password',{current:'Secure-member-2026!',password:'Updated-password-2026!'},member)).status,200);
    assert.equal((await get('/akun',member)).status,302);
    assert.equal((await post('/masuk',{email:'member@example.test',password:'Secure-member-2026!'})).status,400);
    assert.equal((await post('/masuk',{email:'member@example.test',password:'Updated-password-2026!'})).status,302);
  });
  assert.doesNotMatch(log,/ReferenceError|TypeError|SQLITE_ERROR/);
});
