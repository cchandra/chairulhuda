import express from 'express';
import multer from 'multer';
import { randomBytes, createHash } from 'node:crypto';
import { openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dataDir, topics, hashPassword, verifyPassword } from './lib/db.mjs';

const app = express();
const root = fileURLToPath(new URL('.', import.meta.url));
const production = process.env.NODE_ENV === 'production';
const validBase = (()=> { try { const url = new URL(process.env.BASE_URL); return /^https?:$/.test(url.protocol) ? url.origin : ''; } catch { return ''; } })();
const siteOrigin = validBase || 'http://localhost:3000';
app.disable('x-powered-by');
app.set('view engine','ejs');
app.set('views',join(root,'views'));
app.use((req,res,next)=>{
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
  if(production) res.set('Strict-Transport-Security','max-age=31536000');
  next();
});
app.use(express.static(join(root,'public'),{maxAge:production?'1d':0}));
app.use(express.urlencoded({extended:false,limit:'200kb'}));
const tokenHash=t=>createHash('sha256').update(t).digest('hex');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));
app.use((req,res,next)=>{
  const token=cookies(req).ch_session;
  req.user=token?db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?').get(tokenHash(token),Date.now()):null;
  res.locals.user=req.user;
  res.locals.path=req.path;
  res.locals.contentKind=req.query.jenis||'';
  res.locals.topics=topics;
  res.locals.isPro=!!req.user&&(req.user.role==='admin'||new Date(req.user.membership_until)>new Date());
  res.locals.siteOrigin=siteOrigin;
  res.locals.contactEmail=process.env.CONTACT_EMAIL||'';
  res.locals.error=null;
  res.locals.values={};
  res.locals.message=null;
  if(req.user)res.set('Cache-Control','private, no-store');
  next();
});
// All mutations require a browser-origin match. No cookies or external tokens
// can bypass membership checks; premium content is never sent to non-members.
app.use((req,res,next)=>{
  if(req.method==='POST') {
    const origin=req.headers.origin;
    const allowed=validBase?[validBase]:[`http://${req.get('host')}`,`https://${req.get('host')}`];
    if(!origin||!allowed.includes(origin))return res.status(403).send('Permintaan tidak dapat diverifikasi. Muat ulang halaman lalu coba lagi.');
  }
  next();
});
function render(res,view,title,data={},status=200){res.status(status).render('layout',{view,title,description:'Kajian Prof. Chairul Huda mengenai tindak pidana, kesalahan, pertanggungjawaban pidana, putusan pengadilan, dan pemidanaan.',...data});}
function rateLimit(req,res,key,max=10){
  const id=key+':'+tokenHash(req.socket.remoteAddress||'unknown');
  db.prepare('DELETE FROM rate_limits WHERE expires_at<?').run(Date.now());
  const row=db.prepare('SELECT * FROM rate_limits WHERE key=?').get(id);
  if(row&&row.count>=max){res.set('Retry-After','900'); render(res,'notice','Coba kembali nanti',{heading:'Terlalu banyak percobaan',text:'Silakan coba kembali dalam 15 menit.'},429);return false;}
  db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(id,Date.now()+900000);return true;
}
function loginRequired(req,res,next){if(!req.user)return res.redirect('/masuk');next();}
function adminRequired(req,res,next){if(!req.user)return res.redirect('/masuk');if(req.user.role!=='admin')return render(res,'notice','Akses terbatas',{heading:'Akses terbatas',text:'Halaman ini hanya untuk pengelola website.'},403);next();}
function session(req,res,id){
  const token=randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token),id,Date.now()+604800000);
  res.cookie('ch_session',token,{httpOnly:true,secure:production,sameSite:'lax',maxAge:604800000,path:'/'});
}
const field=(body,name,max=500)=>typeof body[name]==='string'?body[name].trim().slice(0,max):'';
const validEmail=e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)&&e.length<=254;
const listColumns='id,slug,title,summary,topic,kind,access,author,updated_at';
app.get('/',(req,res)=>render(res,'home','Prof. Chairul Huda — Pusat Ilmu Hukum Pidana',{materials:db.prepare(`SELECT ${listColumns} FROM materials WHERE status='published' ORDER BY created_at DESC,id DESC LIMIT 3`).all()}));
app.get('/pustaka',(req,res)=>{
  const q=typeof req.query.q==='string'?req.query.q.slice(0,150):'';
  const topic=topics.includes(req.query.topik)?req.query.topik:'';
  const kind=['Artikel','Bedah Putusan','Kelas','Makalah'].includes(req.query.jenis)?req.query.jenis:'';
  const conditions=["status='published'"]; const args=[];
  if(q){conditions.push('(title LIKE ? OR summary LIKE ? OR topic LIKE ?)');args.push(...Array(3).fill(`%${q}%`));}
  if(topic){conditions.push('topic=?');args.push(topic);}
  if(kind){conditions.push('kind=?');args.push(kind);}
  const materials=db.prepare(`SELECT ${listColumns} FROM materials WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC,id DESC`).all(...args);
  render(res,'library',kind==='Bedah Putusan'?'Bedah Putusan':'Pustaka Ilmu Pidana',{materials,q,topic,kind});
});
app.get('/pustaka/:slug',(req,res)=>{
  const material=db.prepare("SELECT * FROM materials WHERE slug=? AND status='published'").get(req.params.slug);
  if(!material)return render(res,'notice','Materi tidak ditemukan',{heading:'Materi belum tersedia',text:'Jelajahi pustaka untuk menemukan bacaan lainnya.'},404);
  const locked=material.access==='premium'&&!res.locals.isPro;
  if(locked){material.body='';material.attachment=null;}
  const saved=!!req.user&&!!db.prepare('SELECT 1 FROM bookmarks WHERE user_id=? AND material_id=?').get(req.user.id,material.id);
  render(res,'article',material.title,{material,locked,saved,description:material.summary});
});
app.get('/unduh/:id',loginOptionalDownload);
app.get('/media/:id',(req,res)=>{
  const material=db.prepare("SELECT * FROM materials WHERE id=? AND status='published'").get(req.params.id);
  if(!material?.attachment||!['.mp4','.mp3'].includes(extname(material.attachment)))return res.status(404).send('Media tidak ditemukan.');
  if(material.access==='premium'&&!res.locals.isPro)return res.status(403).send('Akses Profesional diperlukan.');
  res.set('Cache-Control','private, no-store');
  res.sendFile(join(dataDir,'uploads',basename(material.attachment)));
});
function loginOptionalDownload(req,res){
  const material=db.prepare("SELECT * FROM materials WHERE id=? AND status='published'").get(req.params.id);
  if(!material?.attachment)return res.status(404).send('Berkas tidak ditemukan.');
  if(material.access==='premium'&&!res.locals.isPro)return res.status(403).send('Akses Profesional diperlukan.');
  res.set('Cache-Control','private, no-store');
  res.download(join(dataDir,'uploads',basename(material.attachment)),material.attachment_name);
}
app.post('/simpan/:id',loginRequired,(req,res)=>{
  const material=db.prepare("SELECT id,slug FROM materials WHERE id=? AND status='published'").get(req.params.id);
  if(!material)return res.status(404).send('Materi tidak ditemukan.');
  const exists=db.prepare('SELECT 1 FROM bookmarks WHERE user_id=? AND material_id=?').get(req.user.id,material.id);
  db.prepare(exists?'DELETE FROM bookmarks WHERE user_id=? AND material_id=?':'INSERT INTO bookmarks(user_id,material_id) VALUES(?,?)').run(req.user.id,material.id);
  res.redirect(`/pustaka/${material.slug}`);
});
app.get('/tentang',(req,res)=>render(res,'about','Tentang Prof. Chairul Huda'));
app.get('/kelas',(req,res)=>render(res,'classes','Kelas & Diskusi',{materials:db.prepare(`SELECT ${listColumns} FROM materials WHERE status='published' AND kind='Kelas' ORDER BY id DESC`).all()}));
app.get('/profesional',(req,res)=>render(res,'professional','Akses Profesional untuk Lawyer'));
app.get('/layanan',(req,res)=>render(res,'services','Layanan Ahli'));
app.get('/privasi',(req,res)=>render(res,'privacy','Privasi & Ketentuan'));
app.get('/masuk',(req,res)=>req.user?res.redirect('/akun'):render(res,'auth','Masuk',{mode:'login'}));
app.get('/daftar',(req,res)=>req.user?res.redirect('/akun'):render(res,'auth','Buat Akun',{mode:'register'}));
app.post('/daftar',(req,res)=>{
  if(!rateLimit(req,res,'register',8))return;
  const name=field(req.body,'name',100),email=field(req.body,'email',254).toLowerCase(),password=field(req.body,'password',256);
  const invalid=!name||!validEmail(email)||password.length<12||req.body.consent!=='yes';
  if(invalid)return render(res,'auth','Buat Akun',{mode:'register',error:'Isi nama, email yang valid, kata sandi minimal 12 karakter, dan persetujuan privasi.',values:{name,email}},400);
  if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return render(res,'auth','Buat Akun',{mode:'register',error:'Email tidak dapat digunakan. Jika sudah memiliki akun, silakan masuk.',values:{name,email}},400);
  const result=db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name,email,hashPassword(password));
  session(req,res,Number(result.lastInsertRowid));res.redirect('/akun');
});
app.post('/masuk',(req,res)=>{
  if(!rateLimit(req,res,'login'))return;
  const email=field(req.body,'email',254).toLowerCase(),password=field(req.body,'password',256);
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  // Dummy verification keeps non-existent account and incorrect-password paths comparable.
  const valid=verifyPassword(password,user?.password||'00000000000000000000000000000000:3dca36a386f0493fdca2a1ff703e950a1454ce0a64c13d790b1c56c71ac0c6b828044a0fe81c11d3d1ff5cf5890fc1fe8299b3f446c9423d42e4a3668cb3f7d1');
  if(!user||!valid)return render(res,'auth','Masuk',{mode:'login',error:'Email atau kata sandi tidak cocok.',values:{email}},400);
  session(req,res,user.id);res.redirect(user.role==='admin'?'/admin':'/akun');
});
app.post('/keluar',(req,res)=>{
  const token=cookies(req).ch_session;if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(tokenHash(token));
  res.clearCookie('ch_session',{path:'/'});res.redirect('/');
});
app.get('/akun',loginRequired,(req,res)=>render(res,'account','Ruang Saya',{materials:db.prepare(`SELECT m.* FROM bookmarks b JOIN materials m ON m.id=b.material_id WHERE b.user_id=? AND m.status='published'`).all(req.user.id).map(({body,...m})=>m),inquiries:db.prepare('SELECT * FROM inquiries WHERE user_id=? ORDER BY id DESC').all(req.user.id)}));
app.post('/akun/password',loginRequired,(req,res)=>{
  if(!rateLimit(req,res,'password'))return;
  const current=field(req.body,'current',256),password=field(req.body,'password',256);
  if(password.length<12||!verifyPassword(current,req.user.password))return render(res,'notice','Perubahan belum tersimpan',{heading:'Periksa kata sandi',text:'Kata sandi saat ini harus benar dan kata sandi baru minimal 12 karakter.'},400);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password),req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);session(req,res,req.user.id);
  render(res,'notice','Kata sandi diperbarui',{heading:'Kata sandi diperbarui',text:'Perangkat lain telah dikeluarkan dari akun Anda.'});
});
app.post('/permintaan',(req,res)=>{
  if(!rateLimit(req,res,'inquiry',12))return;
  const type=field(req.body,'type',80),name=field(req.body,'name',100),email=field(req.body,'email',254).toLowerCase(),organization=field(req.body,'organization',150),message=field(req.body,'message',5000);
  const types=['Profesional','Firma Hukum','Kelas & Diskusi','Konsultasi Akademik','Legal Opinion','Keterangan Ahli','Narasumber'];
  if(field(req.body,'website'))return res.status(400).send('Permintaan tidak valid.');
  if(!types.includes(type)||!name||!validEmail(email)||message.length<10||req.body.consent!=='yes')return render(res,'notice','Periksa permintaan',{heading:'Data belum lengkap',text:'Isi nama, email, jenis permintaan, pesan minimal 10 karakter, dan persetujuan privasi. Kembali ke formulir untuk melengkapi.'},400);
  db.prepare('INSERT INTO inquiries(user_id,type,name,email,organization,message) VALUES(?,?,?,?,?,?)').run(req.user?.id||null,type,name,email,organization,message);
  render(res,'notice','Permintaan tersimpan',{heading:'Terima kasih, permintaan Anda tersimpan.',text:'Pengelola dapat meninjau permintaan Anda melalui dashboard. Pengajuan ini belum merupakan konfirmasi jadwal, penerimaan perkara, atau pembayaran.'});
});
const extensions=['.pdf','.docx','.pptx','.mp4','.mp3'];
const upload=multer({storage:multer.diskStorage({destination:join(dataDir,'uploads'),filename:(req,file,cb)=>cb(null,randomBytes(24).toString('hex')+extname(file.originalname).toLowerCase())}),limits:{fileSize:100*1024*1024,files:1,fields:20},fileFilter:(req,file,cb)=>extensions.includes(extname(file.originalname).toLowerCase())?cb(null,true):cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE'))});
app.get('/admin',adminRequired,(req,res)=>render(res,'admin','Dashboard Pengelola',{tab:'overview',materials:db.prepare('SELECT * FROM materials ORDER BY id DESC').all(),members:db.prepare('SELECT id,name,email,role,membership_until FROM users ORDER BY id DESC').all(),inquiries:db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 200').all()}));
app.get('/admin/materi/baru',adminRequired,(req,res)=>render(res,'editor','Materi Baru',{material:{topic:topics[0],kind:'Artikel',access:'public',status:'draft',author:'Tim Editorial'}}));
app.get('/admin/materi/:id',adminRequired,(req,res)=>{
  const material=db.prepare('SELECT * FROM materials WHERE id=?').get(req.params.id);if(!material)return res.status(404).send('Materi tidak ditemukan.');
  render(res,'editor','Edit Materi',{material});
});
app.post('/admin/materi',adminRequired,upload.single('attachment'),(req,res)=>{
  const b=req.body,id=field(b,'id',20),title=field(b,'title',200),summary=field(b,'summary',600),body=field(b,'body',100000),topic=field(b,'topic',100),kind=field(b,'kind',40),access=field(b,'access',20),status=field(b,'status',20),author=field(b,'author',100)||'Tim Editorial',source_url=field(b,'source_url',1500),source_label=field(b,'source_label',150);
  const cleanUpload=()=>{if(req.file)unlinkSync(req.file.path);};
  const reject=message=>{cleanUpload();return render(res,'editor','Periksa Materi',{material:{...b},error:message},400);};
  if(req.file){
    const fd=openSync(req.file.path,'r'),header=Buffer.alloc(12);readSync(fd,header,0,12,0);closeSync(fd);
    const ext=extname(req.file.filename);
    const valid=ext==='.pdf'?header.subarray(0,5).toString()==='%PDF-':['.docx','.pptx'].includes(ext)?header.subarray(0,4).equals(Buffer.from([80,75,3,4])):ext==='.mp4'?header.subarray(4,8).toString()==='ftyp':header.subarray(0,3).toString()==='ID3'||(header[0]===255&&(header[1]&224)===224);
    if(!valid)return reject('Isi berkas tidak sesuai dengan formatnya. Gunakan PDF, DOCX, PPTX, MP4, atau MP3 yang valid.');
  }
  let validSource=!source_url;try{if(source_url)validSource=['https:','http:'].includes(new URL(source_url).protocol);}catch{}
  if(!title||!summary||!body||!topics.includes(topic)||!['Artikel','Bedah Putusan','Kelas','Makalah'].includes(kind)||!['public','premium'].includes(access)||!['draft','published'].includes(status)||!validSource)return reject('Lengkapi judul, ringkasan, isi, kategori, dan URL sumber yang valid.');
  if(status==='published'&&b.reviewed!=='yes')return reject('Konfirmasi bahwa materi dan izin publikasi telah ditinjau sebelum menerbitkan.');
  const existing=id?db.prepare('SELECT * FROM materials WHERE id=?').get(id):null;
  if(id&&!existing)return reject('Materi tidak ditemukan.');
  const attachment=req.file?.filename||existing?.attachment||null,attachment_name=req.file?.originalname||existing?.attachment_name||null;
  const slug=existing?.slug||title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120)+'-'+randomBytes(3).toString('hex');
  const args=[slug,title,summary,body,topic,kind,access,status,author,source_url||null,source_label||null,attachment,attachment_name];
  if(existing)db.prepare('UPDATE materials SET slug=?,title=?,summary=?,body=?,topic=?,kind=?,access=?,status=?,author=?,source_url=?,source_label=?,attachment=?,attachment_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(...args,id);
  else db.prepare('INSERT INTO materials(slug,title,summary,body,topic,kind,access,status,author,source_url,source_label,attachment,attachment_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...args);
  if(req.file&&existing?.attachment)unlinkSync(join(dataDir,'uploads',basename(existing.attachment)));
  res.redirect('/admin');
});
app.post('/admin/anggota/:id',adminRequired,(req,res)=>{
  const until=field(req.body,'until',10);
  if(until&&(!/^\d{4}-\d{2}-\d{2}$/.test(until)||isNaN(Date.parse(until))))return res.status(400).send('Tanggal tidak valid.');
  db.prepare("UPDATE users SET membership_until=? WHERE id=? AND role!='admin'").run(until?until+'T23:59:59.999Z':null,req.params.id);res.redirect('/admin#anggota');
});
app.post('/admin/permintaan/:id',adminRequired,(req,res)=>{
  const status=field(req.body,'status',20);if(!['new','reviewed','closed'].includes(status))return res.status(400).send('Status tidak valid.');
  db.prepare('UPDATE inquiries SET status=? WHERE id=?').run(status,req.params.id);res.redirect('/admin#permintaan');
});
app.get('/health',(req,res)=>{db.prepare('SELECT 1').get();res.json({status:'ok'});});
app.get('/robots.txt',(req,res)=>res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /akun\nDisallow: /masuk\nDisallow: /daftar\nSitemap: ${siteOrigin}/sitemap.xml`));
app.get('/sitemap.xml',(req,res)=>{
  const paths=['/','/tentang','/pustaka','/kelas','/profesional','/layanan',...db.prepare("SELECT slug FROM materials WHERE status='published'").all().map(m=>'/pustaka/'+m.slug)];
  res.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+paths.map(p=>`<url><loc>${siteOrigin}${p}</loc></url>`).join('')+'</urlset>');
});
app.use((req,res)=>render(res,'notice','Halaman tidak ditemukan',{heading:'Halaman tidak ditemukan',text:'Kembali ke beranda atau jelajahi pustaka ilmu pidana.'},404));
app.use((err,req,res,next)=>{
  if(err instanceof multer.MulterError)return render(res,'notice','Unggahan belum berhasil',{heading:'Periksa dokumen Anda',text:'Unggah satu berkas PDF, DOCX, PPTX, MP4, atau MP3 dengan ukuran maksimal 100 MB.'},400);
  console.error(err.message);
  render(res,'notice','Terjadi kendala',{heading:'Halaman belum dapat dimuat',text:'Silakan coba kembali. Jika masih terjadi, hubungi pengelola.'},500);
});
app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.info('Chairul Huda website listening on configured port'));
