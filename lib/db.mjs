import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { researchAreas } from './publications.mjs';

export const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(resolve(dataDir, 'uploads'), { recursive: true });
export const db = new DatabaseSync(resolve(dataDir, 'chairulhuda.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', membership_until TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, topic TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'Artikel', access TEXT NOT NULL DEFAULT 'public', status TEXT NOT NULL DEFAULT 'draft', author TEXT NOT NULL DEFAULT 'Tim Editorial', source_url TEXT, source_label TEXT, attachment TEXT, attachment_name TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS bookmarks(user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, material_id INTEGER REFERENCES materials(id) ON DELETE CASCADE, PRIMARY KEY(user_id, material_id));
CREATE TABLE IF NOT EXISTS inquiries(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, organization TEXT, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
`);
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const calculated = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === calculated.length && timingSafeEqual(expected, calculated);
}
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (adminEmail && process.env.ADMIN_PASSWORD) {
  if (process.env.ADMIN_PASSWORD.length < 14) throw new Error('ADMIN_PASSWORD must contain at least 14 characters');
  if (!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) {
    db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,'admin')").run('Administrator',adminEmail,hashPassword(process.env.ADMIN_PASSWORD));
    console.info('Initial administrator provisioned. Remove ADMIN_PASSWORD from deployment configuration.');
  }
}
// Seed navigable topic introductions, explicitly attributed to editorial staff,
// not represented as writings or approved legal opinions by the professor.
if (!db.prepare('SELECT id FROM materials LIMIT 1').get()) {
  const seed = db.prepare('INSERT INTO materials(slug,title,summary,body,topic,kind,status,author,source_url,source_label) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const introductions = [
    ['membaca-hukum-pidana','Dari mana mulai mempelajari hukum pidana?','Sebuah peta baca: perbuatan, pertanggungjawaban, dan pemidanaan.','Hukum pidana dapat dipelajari melalui tiga pertanyaan awal: perbuatan apa yang dilarang, bagaimana pertanggungjawaban dibahas, dan bagaimana pemidanaan dipertimbangkan. Ketiga pertanyaan tersebut menjadi pintu masuk untuk menata bacaan.\n\nSaat membaca suatu aturan, catat nomor peraturan, sumber resminya, tanggal, serta ruang lingkup pembahasannya. Saat membaca pendapat akademik, bedakan uraian penulis dari bunyi aturan yang dirujuk.\n\nPustaka ini disiapkan untuk menghubungkan tulisan, referensi, dan pembelajaran berdasarkan topik. Pengantar ini merupakan materi orientasi tim editorial; publikasi dan kajian Prof. Chairul Huda akan ditambahkan setelah disetujui.','Dasar Hukum Pidana','https://peraturan.bpk.go.id/','Database Peraturan BPK'],
    ['membaca-putusan-pidana','Membaca putusan dengan lebih terstruktur','Pisahkan fakta, isu hukum, pertimbangan, dan amar saat menyusun catatan riset.','Mulailah dari identitas putusan: pengadilan, nomor perkara, tanggal, dan tingkat pemeriksaan. Informasi tersebut membantu memastikan bahwa dokumen yang dibaca sesuai dengan perkara yang sedang diteliti.\n\nBuat catatan terpisah untuk uraian fakta, pendapat para pihak, pertimbangan majelis, dan amar. Catat halaman sumber untuk setiap kutipan. Ringkasan yang baik memudahkan pembaca kembali ke dokumen aslinya.\n\nPerbandingan dengan putusan lain perlu memperhatikan konteks fakta dan aturan yang dibahas. Pengantar editorial ini adalah panduan menata bacaan, bukan analisis atas suatu perkara atau pendapat Prof. Chairul Huda.','Putusan & Pembuktian','https://putusan3.mahkamahagung.go.id/','Direktori Putusan Mahkamah Agung'],
    ['menata-riset-pertanggungjawaban','Menata riset pertanggungjawaban pidana','Pertanyaan awal untuk mengumpulkan doktrin, aturan, dan putusan yang relevan.','Sebelum mengumpulkan bahan, tuliskan pertanyaan riset secara spesifik. Apakah pembahasan berfokus pada subjek, bentuk perbuatan, unsur kesalahan, atau hubungan antara beberapa pelaku?\n\nKelompokkan bahan menjadi sumber peraturan, putusan, dan tulisan akademik. Untuk setiap bahan, simpan kutipan yang diperlukan beserta halaman dan catatan konteks. Hindari melepas satu kalimat dari keseluruhan pembahasan.\n\nHalaman ini merupakan pengantar editorial untuk navigasi pustaka. Kajian khusus dan publikasi profesor akan tersedia setelah proses kurasi dan persetujuan.','Pertanggungjawaban Pidana','https://peraturan.bpk.go.id/','Database Peraturan BPK']
  ];
  for (const [slug,title,summary,body,topic,url,label] of introductions) seed.run(slug,title,summary,body,topic,'Artikel','published','Tim Editorial',url,label);
}
// Preserve existing material while moving it into the publication-led taxonomy.
const topicMigrations = [
  ['Dasar Hukum Pidana','Tindak Pidana & Pertanggungjawaban'],
  ['Pertanggungjawaban Pidana','Tindak Pidana & Pertanggungjawaban'],
  ['Putusan & Pembuktian','Putusan & Upaya Hukum'],
  ['Hukum Acara Pidana','Sistem Peradilan Pidana & KUHAP'],
  ['Pemidanaan','Pemidanaan & Pemberatan']
];
for (const [before,after] of topicMigrations) db.prepare('UPDATE materials SET topic=? WHERE topic=?').run(after,before);
export const topics = researchAreas.map(area=>area.title);
