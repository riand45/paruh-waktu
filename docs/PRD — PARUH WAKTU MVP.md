# Product Requirements Document (PRD)

# PARUH WAKTU — MVP

**Version:** 1.0  
**Status:** Draft / MVP  
**Platform:** Web Application  
**Target Users:** ±50 users initially  
**Primary Language:** Indonesian

---

# 1. Product Overview

## 1.1 Product Name

**PARUH WAKTU**

## 1.2 Product Description

PARUH WAKTU adalah platform marketplace pekerjaan yang mempertemukan orang yang membutuhkan bantuan pekerjaan dengan orang yang mencari pekerjaan/tugas.

Platform memiliki tiga jenis pengguna utama:

1. **Pencari Kerja**
2. **Pemberi Kerja**
3. **Admin**

Satu user dapat berperan sebagai **Pencari Kerja sekaligus Pemberi Kerja**.

Pada saat pertama kali melakukan registrasi, user secara default menjadi **Pencari Kerja**.

Apabila user ingin membuat pekerjaan, user harus mengajukan verifikasi sebagai **Pemberi Kerja** kepada Admin.

---

# 2. Product Goals

Tujuan utama MVP:

- Menyediakan platform sederhana untuk mencari dan menawarkan pekerjaan.
- Memungkinkan Pemberi Kerja membuat pekerjaan.
- Memungkinkan Pencari Kerja menemukan dan melamar pekerjaan.
- Memungkinkan Pemberi Kerja memilih Pencari Kerja.
- Menyediakan proses pembayaran manual.
- Menyediakan wallet untuk mencatat pendapatan Pencari Kerja.
- Menyediakan proses withdrawal manual.
- Menyediakan komunikasi antara Pemberi Kerja dan Pencari Kerja.
- Menyediakan Admin untuk melakukan verifikasi dan mengelola transaksi.
- Memvalidasi konsep bisnis sebelum pengembangan fitur lanjutan.

---

# 3. MVP Scope

MVP mencakup:

- Authentication
- User profile
- Pencari Kerja
- Pengajuan Pemberi Kerja
- Verifikasi Pemberi Kerja
- KTP verification secara manual
- Job category
- Create job
- Job listing
- Job detail
- Job application
- Job assignment
- Location-based job discovery
- Manual payment
- Payment proof upload
- Admin payment verification
- Platform fee configuration
- Wallet
- Wallet transaction history
- Withdrawal
- Admin withdrawal processing
- Job completion
- Work evidence upload
- Realtime chat
- Admin dashboard
- Admin user management
- Admin job management
- Admin payment management
- Admin withdrawal management
- Admin configuration
- Audit log

---

# 4. User Roles

## 4.1 Pencari Kerja

Pencari Kerja adalah user yang mencari pekerjaan.

Fitur utama:

- Melihat pekerjaan
- Mencari pekerjaan
- Filter pekerjaan
- Melihat detail pekerjaan
- Melamar pekerjaan
- Melihat pekerjaan yang sedang berjalan
- Berkomunikasi dengan Pemberi Kerja
- Mengirim bukti pekerjaan
- Melihat wallet
- Mengajukan withdrawal
- Melihat riwayat transaksi

---

## 4.2 Pemberi Kerja

Pemberi Kerja adalah user yang membuat pekerjaan.

Pemberi Kerja harus melalui proses verifikasi Admin terlebih dahulu.

Fitur utama:

- Membuat pekerjaan
- Mengelola pekerjaan
- Melihat pelamar
- Memilih Pencari Kerja
- Melakukan pembayaran
- Melihat status pekerjaan
- Berkomunikasi dengan Pencari Kerja
- Mengkonfirmasi pekerjaan selesai

---

## 4.3 Admin

Admin merupakan pihak yang mengelola platform.

Admin menggunakan web admin panel yang terpisah secara route dari user biasa.

Admin dapat:

- Mengelola user
- Memverifikasi Pemberi Kerja
- Memverifikasi KTP
- Mengelola pekerjaan
- Memverifikasi pembayaran
- Mengelola withdrawal
- Mengelola kategori pekerjaan
- Mengatur platform fee
- Mengelola konfigurasi platform
- Melihat audit log

---

# 5. User Account

## 5.1 Registration

User dapat membuat akun menggunakan:

- Nama
- Email
- Nomor telepon
- Password

Setelah registrasi, user otomatis memiliki kemampuan sebagai:

**Pencari Kerja**

---

# 6. Dual Role

Satu user dapat menjadi:

**Pencari Kerja + Pemberi Kerja**

Tidak diperlukan dua akun terpisah.

Contoh:

```text
User A
├── Pencari Kerja
└── Pemberi Kerja
```

User tetap menggunakan satu akun dan satu profile.

---

# 7. Employer Verification

## 7.1 Purpose

Verifikasi diperlukan agar hanya user yang telah disetujui Admin yang dapat membuat pekerjaan.

## 7.2 Flow

```text
User
 ↓
Pencari Kerja
 ↓
Request menjadi Pemberi Kerja
 ↓
Melengkapi data
 ↓
Upload KTP
 ↓
Admin Review
 ↓
Approved / Rejected
```

## 7.3 Verification Status

Status:

- Pending
- Approved
- Rejected

Jika ditolak, Admin dapat memberikan alasan penolakan.

## 7.4 Business Rule

User yang belum mendapatkan approval:

**Tidak dapat membuat pekerjaan.**

---

# 8. KTP Verification

Verifikasi KTP dilakukan secara manual oleh Admin.

MVP tidak menggunakan:

- OCR otomatis
- Face recognition
- Liveness detection
- Automated KYC

Admin dapat melihat dokumen yang dikirim user dan menentukan:

- Approved
- Rejected

---

# 9. Job Category

Pekerjaan memiliki kategori.

Kategori dikelola oleh Admin.

Contoh:

- Bantuan Sekitar
- Pekerjaan Fisik Ringan
- Bantuan Digital
- Kreatif
- Online

Kategori harus dapat ditambahkan atau diubah oleh Admin.

---

# 10. Job

## 10.1 Create Job

Pemberi Kerja dapat membuat pekerjaan.

Informasi minimal:

- Judul pekerjaan
- Kategori
- Deskripsi
- Lokasi
- Latitude
- Longitude
- Nominal pembayaran
- Durasi pekerjaan
- Deadline
- Foto/video atau attachment jika diperlukan

---

# 11. Job Status

Pekerjaan memiliki lifecycle.

Status minimal:

```text
Draft
Open
Assigned
Waiting Payment
Payment Review
Payment Verified
In Progress
Waiting Confirmation
Completed
Cancelled
Payment Rejected
```

Status harus berubah mengikuti proses bisnis dan tidak dapat diubah sembarangan oleh user.

---

# 12. Job Listing

Pencari Kerja dapat melihat pekerjaan yang tersedia.

Informasi pada job listing minimal:

- Judul
- Kategori
- Lokasi
- Jarak
- Nominal pembayaran
- Durasi
- Deadline
- Status

Pekerjaan yang sudah selesai atau dibatalkan tidak boleh ditampilkan sebagai pekerjaan yang tersedia.

---

# 13. Job Search

Pencari Kerja dapat:

- Search pekerjaan
- Filter berdasarkan kategori
- Filter berdasarkan lokasi
- Filter berdasarkan radius
- Filter berdasarkan nominal
- Melihat pekerjaan terdekat

---

# 14. Location

Platform menggunakan lokasi untuk membantu Pencari Kerja menemukan pekerjaan di sekitar mereka.

MVP menggunakan:

- Latitude
- Longitude
- Map
- Distance calculation

User dapat melihat lokasi pekerjaan pada peta.

MVP tidak memerlukan navigasi turn-by-turn.

---

# 15. Job Application

Pencari Kerja dapat melamar pekerjaan yang berstatus:

**Open**

Flow:

```text
Pencari Kerja
 ↓
Melihat Job
 ↓
Apply
 ↓
Employer melihat Applicant
 ↓
Employer memilih Worker
```

Application memiliki status:

- Pending
- Accepted
- Rejected
- Cancelled

---

# 16. Job Assignment

Pemberi Kerja dapat memilih salah satu Pencari Kerja dari daftar applicant.

Setelah Pencari Kerja dipilih:

```text
Job
 ↓
Assigned to Worker
```

Satu pekerjaan hanya boleh memiliki satu Pencari Kerja aktif.

Setelah assignment dilakukan, pekerjaan tidak dapat diambil oleh Pencari Kerja lain.

---

# 17. Payment

## 17.1 Payment Method

MVP menggunakan:

**Manual Bank Transfer**

Belum menggunakan payment gateway.

---

# 18. Manual Payment Flow

```text
Employer
 ↓
Worker Assigned
 ↓
Payment Instruction
 ↓
Transfer ke rekening Admin
 ↓
Upload Bukti Transfer
 ↓
Admin Review
 ↓
Approved / Rejected
```

---

# 19. Payment Proof

Pemberi Kerja dapat mengupload bukti transfer.

Minimal informasi:

- Payment amount
- Transfer date
- Transfer proof
- Payment status

Admin dapat melihat bukti transfer.

---

# 20. Payment Verification

Admin bertanggung jawab memverifikasi pembayaran.

Admin dapat:

- Approve payment
- Reject payment
- Memberikan alasan rejection

Payment status:

- Waiting Payment
- Waiting Verification
- Verified
- Rejected

---

# 21. Platform Fee

Platform mendapatkan fee dari transaksi.

Nilai default dapat dikonfigurasi.

Contoh:

```text
Platform Fee = 10%
```

Namun angka tersebut **tidak boleh dianggap sebagai nilai permanen**.

Admin harus dapat mengubah konfigurasi fee.

Platform fee dapat dikonfigurasi berdasarkan pihak yang membayar:

- Employer
- Worker
- Split

Business rule final mengenai pihak yang menanggung fee dapat ditentukan kemudian.

---

# 22. Wallet

Pencari Kerja memiliki wallet.

Wallet digunakan untuk mencatat:

- Pendapatan
- Platform fee
- Withdrawal
- Refund
- Adjustment

Wallet harus memiliki riwayat transaksi.

User dapat melihat:

- Current balance
- Available balance
- Transaction history

---

# 23. Wallet Transaction

Setiap perubahan saldo harus menghasilkan transaction record.

Contoh:

```text
Job Income
Platform Fee
Withdrawal
Refund
Adjustment
```

User tidak dapat mengubah saldo wallet secara langsung.

---

# 24. Job Completion

Setelah pekerjaan selesai dilakukan, Pencari Kerja dapat mengirimkan completion request.

Flow:

```text
Worker
 ↓
Upload Evidence
 ↓
Submit Completion
 ↓
Waiting Confirmation
 ↓
Employer Review
 ↓
Confirm Completed
 ↓
Completed
```

**Pemberi Kerja adalah pihak yang menentukan bahwa pekerjaan selesai.**

Pencari Kerja tidak dapat langsung mengubah pekerjaan menjadi `Completed`.

---

# 25. Work Evidence

Pencari Kerja dapat mengupload bukti pekerjaan.

Jenis file:

- Foto
- Video

Bukti pekerjaan terkait dengan pekerjaan/assignment tertentu.

---

# 26. Wallet After Completion

Setelah pekerjaan dikonfirmasi selesai:

```text
Job Completed
 ↓
Calculate platform fee
 ↓
Create wallet transaction
 ↓
Worker balance updated
```

Pendapatan Pencari Kerja dicatat dalam wallet.

---

# 27. Withdrawal

Pencari Kerja dapat melakukan withdrawal.

Flow:

```text
Worker
 ↓
Request Withdrawal
 ↓
Admin Review
 ↓
Admin Transfer Manual
 ↓
Upload Transfer Proof
 ↓
Paid
```

Status:

- Pending
- Processing
- Paid
- Rejected

---

# 28. Withdrawal Rules

User tidak dapat melakukan withdrawal melebihi saldo yang tersedia.

Withdrawal harus memiliki:

- Amount
- Bank name
- Account number
- Account holder
- Status
- Transfer proof jika sudah dibayarkan

---

# 29. Refund

Refund dilakukan secara manual oleh Admin.

MVP belum menyediakan automated refund.

Jika diperlukan refund:

```text
Admin
 ↓
Process Refund
 ↓
Record transaction
```

Refund harus tercatat pada transaction history.

---

# 30. Realtime Chat

Pencari Kerja dan Pemberi Kerja dapat berkomunikasi melalui chat.

Chat digunakan untuk komunikasi terkait pekerjaan.

Fitur:

- Conversation list
- Message list
- Send message
- Receive message realtime
- Timestamp
- Read/unread

Conversation harus terkait dengan pekerjaan.

---

# 31. Chat Access

User hanya dapat melihat conversation yang memang melibatkan dirinya.

Contoh:

```text
Employer
     ↕
   Chat
     ↕
Worker
```

User lain tidak boleh dapat mengakses conversation tersebut.

---

# 32. Admin Dashboard

Admin memiliki dashboard.

Dashboard menampilkan informasi seperti:

- Total users
- Total workers
- Total employers
- Active jobs
- Completed jobs
- Pending payment
- Pending withdrawal

---

# 33. Admin User Management

Admin dapat:

- Melihat user
- Search user
- Filter user
- Melihat profile
- Melihat status verification
- Activate user
- Suspend user

---

# 34. Admin Employer Verification

Admin dapat:

- Melihat request employer
- Melihat profile
- Melihat dokumen KTP
- Approve
- Reject
- Menambahkan rejection reason

---

# 35. Admin Job Management

Admin dapat:

- Melihat seluruh job
- Search job
- Filter job
- Melihat detail job
- Melihat Employer
- Melihat Worker
- Melihat status
- Cancel job jika diperlukan

---

# 36. Admin Payment Management

Admin dapat:

- Melihat payment
- Melihat bukti transfer
- Approve payment
- Reject payment
- Memberikan alasan rejection
- Melihat payment history

---

# 37. Admin Withdrawal Management

Admin dapat:

- Melihat withdrawal
- Melihat user
- Melihat nominal
- Melihat rekening
- Memproses withdrawal
- Upload bukti transfer
- Mark as paid
- Reject withdrawal

---

# 38. Admin Category Management

Admin dapat:

- Create category
- Edit category
- Activate category
- Deactivate category

---

# 39. Admin Settings

Admin dapat mengatur konfigurasi platform.

Minimal:

- Platform fee
- Fee payer
- Default job radius
- Maximum upload size
- Allowed file types

---

# 40. Audit Log

Aktivitas penting Admin harus tercatat.

Contoh:

- Employer verification approved
- Employer verification rejected
- Payment approved
- Payment rejected
- Withdrawal processed
- Withdrawal rejected
- Refund processed
- User suspended

Audit log minimal menyimpan:

- Admin
- Action
- Entity
- Description
- Timestamp

---

# 41. Notifications

MVP **tidak menggunakan push notification**.

Notifikasi dapat menggunakan mekanisme sederhana di dalam aplikasi jika diperlukan untuk membantu user mengetahui perubahan status.

Push notification native/mobile bukan bagian dari MVP.

---

# 42. File Upload

Platform mendukung upload:

- Avatar
- KTP
- Job attachment
- Work evidence
- Payment proof
- Withdrawal proof

File harus memiliki batas ukuran dan tipe file yang diperbolehkan.

---

# 43. User Experience

Aplikasi harus:

- Responsive
- Mobile friendly
- Mudah digunakan
- Memiliki navigasi sederhana
- Menampilkan status yang jelas
- Menampilkan loading state
- Menampilkan error state
- Menampilkan empty state
- Menampilkan confirmation sebelum tindakan penting

Prioritas UX adalah **mobile-first**, walaupun platform berbasis web.

---

# 44. Security Requirements

MVP wajib memiliki:

- Authentication
- Authorization
- User access control
- Admin access control
- Protected data
- Secure file access
- Validation
- Protection terhadap unauthorized access

Data sensitif seperti KTP dan bukti pembayaran tidak boleh dapat diakses secara bebas oleh user lain.

---

# 45. Business Rules Summary

## User

- Satu user dapat menjadi Worker dan Employer.
- Default user adalah Worker.
- Employer membutuhkan approval Admin.

## Job

- Hanya Employer yang approved dapat membuat job.
- Job dapat dilamar Worker.
- Employer menentukan Worker yang diterima.
- Satu job memiliki satu Worker aktif.

## Payment

- Payment dilakukan manual.
- Transfer dilakukan ke rekening Admin.
- Employer upload bukti transfer.
- Admin melakukan verifikasi.

## Completion

- Worker mengirim completion request.
- Worker dapat mengupload evidence.
- Employer menentukan pekerjaan selesai.

## Wallet

- Pendapatan dicatat setelah pekerjaan selesai.
- Semua perubahan saldo memiliki transaction record.
- Withdrawal diproses manual oleh Admin.

## Refund

- Refund dilakukan manual oleh Admin.

## Dispute

- Dispute belum tersedia di MVP.

## Rating

- Rating/review belum tersedia di MVP.

---

# 46. Out of Scope

Fitur berikut tidak termasuk MVP:

- Android native application
- iOS native application
- Payment gateway
- Automated payout
- Automated escrow
- Push notification
- Rating/review
- Dispute management
- Automated KYC
- OCR KTP
- Face recognition
- Liveness detection
- AI moderation
- Advanced fraud detection
- Advanced analytics
- Social login
- Multi-language
- Advanced recommendation system

Fitur tersebut dapat dikembangkan pada fase berikutnya.

---

# 47. Initial User Target

Estimasi pengguna awal:

**±50 users**

Angka tersebut merupakan target awal, bukan batas maksimal sistem.

Platform harus tetap dirancang agar dapat ditingkatkan kapasitasnya ketika jumlah user dan traffic bertambah.

---

# 48. Platform Infrastructure

MVP merupakan:

**Web Based Application**

Infrastructure seperti:

- Domain
- Hosting/VPS
- Storage
- Third-party service

merupakan biaya terpisah dari development.

Infrastructure dapat ditingkatkan sesuai pertumbuhan pengguna.

---

# 49. MVP Success Criteria

MVP dianggap berhasil apabila:

### Worker

User dapat:

1. Register
2. Login
3. Melengkapi profile
4. Melihat job
5. Search job
6. Filter job
7. Melihat lokasi
8. Apply job
9. Mendapatkan assignment
10. Chat dengan Employer
11. Menyelesaikan pekerjaan
12. Upload evidence
13. Melihat wallet
14. Request withdrawal

### Employer

User dapat:

1. Register
2. Request Employer Verification
3. Upload KTP
4. Mendapatkan approval Admin
5. Create Job
6. Melihat applicant
7. Memilih Worker
8. Melakukan pembayaran
9. Upload bukti transfer
10. Chat dengan Worker
11. Melihat progress pekerjaan
12. Confirm job completed

### Admin

Admin dapat:

1. Login
2. Melihat dashboard
3. Mengelola user
4. Memverifikasi Employer
5. Memverifikasi KTP
6. Mengelola job
7. Memverifikasi payment
8. Mengelola withdrawal
9. Mengelola category
10. Mengatur platform fee
11. Melihat audit log

---

# 50. Future Development

Setelah MVP tervalidasi, kemungkinan pengembangan:

### Phase 2

- Payment gateway
- Push notification
- Rating & review
- Dispute
- Automated refund
- Automated payout
- Improved KYC
- Better search
- Advanced filtering

### Phase 3

- Android application
- iOS application
- Advanced analytics
- Recommendation
- Promotion
- Subscription
- Business account
- Advanced fraud prevention

---

# 51. Product Principle

PARUH WAKTU MVP harus memprioritaskan:

1. Functional business flow
2. Security
3. Simplicity
4. Maintainability
5. User experience
6. Transaction integrity

Jangan membangun fitur di luar MVP sebelum core business flow berjalan dengan baik.

---

# 52. Core Business Flow

Alur utama MVP:

```text
REGISTER
   ↓
PENCARI KERJA
   ↓
REQUEST EMPLOYER
   ↓
ADMIN VERIFICATION
   ↓
EMPLOYER APPROVED
   ↓
CREATE JOB
   ↓
JOB OPEN
   ↓
WORKER APPLY
   ↓
EMPLOYER SELECT WORKER
   ↓
ASSIGNMENT
   ↓
MANUAL PAYMENT
   ↓
UPLOAD PAYMENT PROOF
   ↓
ADMIN VERIFY
   ↓
PAYMENT VERIFIED
   ↓
WORK IN PROGRESS
   ↓
WORKER UPLOAD EVIDENCE
   ↓
WORKER SUBMIT COMPLETION
   ↓
EMPLOYER CONFIRM
   ↓
JOB COMPLETED
   ↓
WALLET TRANSACTION
   ↓
WORKER REQUEST WITHDRAWAL
   ↓
ADMIN PROCESS
   ↓
WITHDRAWAL PAID
```

---

# 53. Product Boundary

PRD ini merupakan **product requirement**, bukan technical implementation specification.

Detail mengenai:

- Database schema
- Supabase RLS
- API
- Server Actions
- Next.js architecture
- Component structure
- Storage bucket
- Realtime implementation
- Deployment

akan ditentukan pada **Technical Specification** dan development documentation.

PRD ini harus menjadi acuan utama untuk menentukan **apa yang harus dibangun** pada MVP.