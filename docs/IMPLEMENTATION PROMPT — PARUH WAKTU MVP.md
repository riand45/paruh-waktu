# PARUH WAKTU — IMPLEMENTATION PROMPT

## 1. ROLE

You are a **Senior Full-Stack Engineer** responsible for implementing the **PARUH WAKTU MVP** based on the existing:

- `PRD.md`
- `TECHNICAL_SPEC.md`
- Existing Next.js project
- Existing UI/prototype, if available

Your responsibility is to transform the product requirements into a **production-ready web application**, not merely a UI prototype.

You must think carefully about:

- architecture
- database integrity
- authentication
- authorization
- Row Level Security
- financial transaction safety
- file security
- realtime communication
- validation
- error handling
- maintainability
- scalability
- security

Do not blindly implement the prototype.

The prototype is only a **visual and user-flow reference**.

The PRD and Technical Specification are the source of truth for functionality and architecture.

---

# 2. PRODUCT

Product name:

**PARUH WAKTU**

Product type:

**Web-based part-time/job marketplace**

Main users:

1. Pencari Kerja
2. Pemberi Kerja
3. Admin

A single registered user may eventually have both:

- Pencari Kerja role
- Pemberi Kerja role

New users initially become:

**Pencari Kerja**

To become a Pemberi Kerja, the user must submit an employer verification request and be approved by Admin.

---

# 3. TECHNOLOGY STACK

Use the following stack unless an existing project constraint requires otherwise:

### Frontend

- Next.js
- App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui or an existing consistent component system

### Backend

Use Next.js server-side functionality together with Supabase.

### Database

- Supabase PostgreSQL

### Authentication

- Supabase Auth

### Storage

- Supabase Storage

### Realtime

- Supabase Realtime

### Validation

- Zod

### Forms

- React Hook Form where appropriate

### Maps

- Leaflet
- OpenStreetMap

Do not introduce unnecessary frameworks or dependencies.

---

# 4. GENERAL IMPLEMENTATION RULES

## 4.1 Do not rewrite the entire project unnecessarily

First inspect the existing project.

Understand:

- existing routes
- components
- layouts
- styling
- dependencies
- configuration
- Supabase setup
- existing authentication
- existing database
- existing UI

Reuse good existing code where possible.

Only refactor when necessary.

---

# 5. FIRST TASK — PROJECT ANALYSIS

Before writing significant implementation code, inspect the project.

Analyze:

### Project structure

Identify:

- app routes
- components
- libraries
- utilities
- hooks
- services
- database-related files
- Supabase configuration
- middleware
- authentication
- styling

### Existing dependencies

Check `package.json`.

Do not install packages that are already available.

### Existing database

Inspect existing migrations/schema if available.

### Existing prototype

If UI/prototype files exist, identify:

- pages
- navigation
- forms
- user flows
- dashboard
- job pages
- payment pages
- chat
- wallet
- admin pages

Do not assume the prototype's implementation is technically correct.

---

# 6. IMPLEMENTATION STRATEGY

Do NOT attempt to implement the entire application in one step.

Implement incrementally.

Use this order:

## Phase 1 — Foundation

Implement:

- project configuration
- Supabase clients
- environment configuration
- database migrations
- base UI components
- authentication
- authorization
- middleware
- role handling
- error handling
- common utilities

---

## Phase 2 — User & Authentication

Implement:

- registration
- login
- logout
- session handling
- profile
- profile editing
- avatar upload
- default Pencari Kerja role

User profile should support:

- name
- email
- phone
- avatar
- address
- latitude
- longitude

Protect authenticated routes.

Unauthenticated users must not access authenticated pages.

---

# 7. ROLE SYSTEM

Implement role management securely.

Roles:

```text
worker
employer
admin
```

However, do not assume a user can simply modify their own role.

Role authorization must be enforced server-side and through database policies.

A normal user must never be able to:

- make themselves admin
- approve themselves as employer
- change another user's role
- modify verification status
- modify financial status

---

# 8. EMPLOYER VERIFICATION

Implement:

```text
Pencari Kerja
      ↓
Request Employer
      ↓
Submit Verification
      ↓
Admin Review
      ↓
Approved / Rejected
```

Statuses:

```text
pending
approved
rejected
```

If rejected:

- store rejection reason
- user can submit again if allowed

Only approved employers can create jobs.

---

# 9. KTP / VERIFICATION DOCUMENT

Implement document upload using Supabase Storage.

Sensitive verification documents must NOT be publicly accessible.

Use:

- private bucket
- authenticated access
- signed URLs where required
- server-side authorization

Never expose unrestricted public URLs for sensitive documents.

Validate:

- file type
- file size
- ownership
- authorization

---

# 10. JOB MARKETPLACE

Implement job categories.

Implement job CRUD according to authorization.

Employer can:

- create job
- edit own draft/open job where allowed
- publish job
- view applications
- select worker
- cancel job according to business rules

Worker can:

- browse jobs
- search jobs
- filter jobs
- view job detail
- apply to job

---

# 11. JOB STATUS

Use the defined business statuses:

```text
draft
open
assigned
waiting_payment
payment_review
payment_verified
in_progress
waiting_confirmation
completed
cancelled
payment_rejected
```

Do not allow arbitrary status updates from the client.

Status transitions must be validated server-side.

For example:

```text
draft → open
open → assigned
assigned → waiting_payment
waiting_payment → payment_review
payment_review → payment_verified
payment_verified → in_progress
in_progress → waiting_confirmation
waiting_confirmation → completed
```

Invalid transitions must be rejected.

---

# 12. JOB APPLICATION

Implement:

```text
Worker
   ↓
Apply
   ↓
Pending
   ↓
Employer Review
   ↓
Accepted / Rejected
```

Application statuses:

```text
pending
accepted
rejected
cancelled
```

Rules:

- worker cannot apply to own job
- worker cannot apply multiple times to the same job unless explicitly allowed
- only authorized employer can manage applications
- only authorized employer can select worker
- selecting a worker must be transaction-safe

---

# 13. ASSIGNMENT

A job may have:

**one active worker assignment**

Prevent race conditions where two workers are selected simultaneously.

Use appropriate:

- database constraints
- transactions
- server-side validation

Never rely only on frontend state.

---

# 14. LOCATION

Implement job location using:

- latitude
- longitude
- address

Use:

**Leaflet + OpenStreetMap**

Create reusable map components.

Map components should be client components only when required.

Do not put API/business logic inside the map component.

The map provider should be replaceable in the future.

---

# 15. PAYMENT

Payment is:

**manual bank transfer**

There is NO payment gateway in MVP.

Flow:

```text
Employer
    ↓
View payment instruction
    ↓
Transfer to Admin account
    ↓
Upload payment proof
    ↓
Admin reviews
    ↓
Approved / Rejected
```

Payment statuses:

```text
waiting_payment
waiting_verification
verified
rejected
```

Do not implement fake automated payment verification.

---

# 16. PAYMENT PROOF

Payment proof must be stored securely.

Use a private Supabase Storage bucket.

Validate:

- ownership
- file type
- file size
- job/payment relation

Only authorized users and Admin should be able to access the proof.

---

# 17. PLATFORM FEE

DO NOT hardcode:

```text
10%
```

The platform fee must be configurable.

Store configuration in:

```text
platform_settings
```

Support:

```text
percentage
```

and fee payer:

```text
employer
worker
split
```

The actual fee calculation must happen server-side.

Never trust:

```text
fee
total
net_amount
```

values sent from the browser.

Calculate them on the server.

---

# 18. WALLET

The wallet is financial functionality.

Treat it as a high-risk component.

Do NOT implement wallet balance as a value that the frontend can directly modify.

Use a ledger-based model.

Transactions should include types such as:

```text
job_income
platform_fee
withdrawal
refund
adjustment
```

Every financial operation must have:

- server-side validation
- authorization
- transaction integrity
- auditability
- idempotency where necessary

Never allow:

```text
client → update wallet balance
```

---

# 19. JOB COMPLETION

Flow:

```text
Worker
    ↓
Upload work evidence
    ↓
Submit completion
    ↓
Waiting confirmation
    ↓
Employer confirms
    ↓
Job completed
```

Worker may upload:

- photo
- video

Evidence must be linked to the correct job/assignment.

Only the assigned worker can submit completion.

Only the employer who owns the job can confirm completion.

---

# 20. WALLET AFTER COMPLETION

When employer confirms completion:

1. Validate assignment.
2. Validate job status.
3. Calculate worker income.
4. Calculate platform fee.
5. Create wallet ledger transactions.
6. Mark job as completed.
7. Prevent duplicate financial transactions.

This operation must be **atomic**.

If any financial operation fails, the completion transaction must not leave the system in an inconsistent state.

---

# 21. WITHDRAWAL

Worker can request withdrawal from available wallet balance.

Statuses:

```text
pending
processing
paid
rejected
```

Admin manually processes withdrawal.

Do not implement automatic bank payout.

Withdrawal amount must be validated server-side.

Prevent:

- withdrawing more than available balance
- duplicate withdrawal
- negative balance
- unauthorized withdrawal
- manipulating wallet balance from client

---

# 22. REFUND

Refund is manual.

Admin may create refund/adjustment transactions where allowed.

Every refund must:

- reference the related transaction/job/payment
- create an auditable wallet transaction
- record Admin action

Do not silently modify balances.

---

# 23. REALTIME CHAT

Implement job-based realtime chat using:

**Supabase Realtime**

A conversation should be associated with a job.

Participants:

- Employer
- Assigned Worker

Only authorized participants can:

- read messages
- send messages

Implement:

- conversation
- participants
- messages
- unread state

Do not allow users to subscribe to conversations they are not authorized to access.

Realtime functionality must not bypass authorization.

---

# 24. FILE UPLOAD

Use Supabase Storage.

Suggested buckets:

```text
avatars
kyc-documents
job-attachments
job-evidences
payment-proofs
withdrawal-proofs
```

Sensitive buckets should be private.

Every upload must validate:

- authenticated user
- authorization
- file type
- file size
- ownership
- entity relation

Do not trust file extension alone.

---

# 25. ADMIN PANEL

Admin should use the same Next.js application.

Routes:

```text
/admin
/admin/users
/admin/employer-verifications
/admin/jobs
/admin/payments
/admin/withdrawals
/admin/categories
/admin/settings
/admin/audit-logs
```

Admin dashboard should show:

- total users
- workers
- employers
- active jobs
- completed jobs
- pending payments
- pending withdrawals

---

# 26. ADMIN AUTHORIZATION

Admin routes must be protected.

A normal user must not be able to access:

```text
/admin/*
```

Do not rely only on hiding menu items.

Authorization must be enforced server-side.

---

# 27. ADMIN USER MANAGEMENT

Admin should be able to:

- view users
- view profile
- view roles
- manage employer verification
- manage appropriate account status

Admin actions must be logged.

---

# 28. ADMIN PAYMENT MANAGEMENT

Admin can:

- view pending payments
- view payment proof
- approve payment
- reject payment
- provide rejection reason

Approval must trigger the correct job/payment state transition.

Do not allow arbitrary state changes.

---

# 29. ADMIN WITHDRAWAL MANAGEMENT

Admin can:

- view withdrawal requests
- mark processing
- mark paid
- reject withdrawal

Record:

- Admin
- timestamp
- action
- related entity
- optional note

---

# 30. ADMIN SETTINGS

Implement configurable settings such as:

```text
platform_fee_percentage
platform_fee_payer
default_job_radius
max_upload_size
allowed_file_types
```

Do not hardcode business configuration into React components.

---

# 31. AUDIT LOG

Implement an audit log for important Admin and financial actions.

Examples:

```text
EMPLOYER_APPROVED
EMPLOYER_REJECTED
PAYMENT_APPROVED
PAYMENT_REJECTED
WITHDRAWAL_PROCESSING
WITHDRAWAL_PAID
WITHDRAWAL_REJECTED
REFUND_CREATED
WALLET_ADJUSTMENT
```

Audit log should include:

- actor
- action
- entity
- entity ID
- timestamp
- relevant metadata

---

# 32. DATABASE IMPLEMENTATION

Create proper Supabase migrations.

Suggested tables:

```text
profiles
user_roles
employer_verifications
job_categories
jobs
job_applications
job_assignments
job_attachments
job_evidences
payments
payment_proofs
wallets
wallet_transactions
withdrawals
conversations
conversation_participants
messages
notifications
audit_logs
platform_settings
```

Use:

- UUID primary keys
- foreign keys
- indexes
- unique constraints
- check constraints where useful
- timestamps
- appropriate enums or constrained values

Do not duplicate data unnecessarily.

---

# 33. DATABASE SECURITY

Implement Supabase RLS.

RLS is mandatory.

Examples:

### Profile

User can:

- read own profile
- update own profile

Admin can access users according to Admin permissions.

### Jobs

Employer can:

- create own jobs
- manage own jobs

Worker can:

- read published jobs

### Applications

Worker can:

- create own applications
- view own applications

Employer can:

- view applications for own jobs
- accept/reject applications

### Messages

Only conversation participants can:

- read
- send

### Wallet

Users can:

- read their own wallet
- read their own transactions

Users cannot directly:

- update balance
- create arbitrary financial transactions

Financial writes should be handled through secure server-side operations.

---

# 34. AUTHENTICATION ARCHITECTURE

Use Supabase Auth.

Ensure:

- session persistence
- protected routes
- authenticated server access
- proper logout
- session refresh

Never expose:

```text
SUPABASE_SERVICE_ROLE_KEY
```

to the browser.

Service-role functionality must remain server-side only.

---

# 35. NEXT.JS ARCHITECTURE

Prefer:

**Server Components by default.**

Use Client Components only where necessary, for example:

- realtime chat
- maps
- interactive forms
- browser-only APIs

Business-critical operations should preferably execute through:

- Server Actions
- Route Handlers
- server-side services
- database functions where appropriate

Do not put critical business rules exclusively in client-side React code.

---

# 36. SERVICE LAYER

Separate business logic from UI.

For example:

```text
src/
  services/
    jobs/
    applications/
    payments/
    wallet/
    withdrawals/
    chat/
    employer-verification/
```

UI components should not contain large business workflows.

Avoid components containing hundreds of lines of business logic.

---

# 37. VALIDATION

Use Zod for input validation.

Validate all important inputs:

- registration
- profile
- employer verification
- job creation
- job application
- payment proof
- withdrawal
- chat messages
- admin settings

Validation must happen server-side.

Client-side validation is only for UX.

---

# 38. AUTHORIZATION

Authentication answers:

> Who is this user?

Authorization answers:

> Is this user allowed to perform this action?

Always implement both.

Examples:

A worker must not be able to:

- approve their own employer verification
- modify another user's job
- approve payment
- modify wallet balance
- process withdrawal
- access Admin pages

---

# 39. ERROR HANDLING

Implement proper:

- loading states
- empty states
- error states
- success states
- form validation errors
- authorization errors
- database errors

Do not expose internal database errors directly to users.

Use user-friendly error messages.

Log technical details server-side where appropriate.

---

# 40. UI / UX

The UI must be:

- responsive
- mobile-friendly
- desktop-friendly
- consistent
- accessible
- clear

The primary user experience should work well on mobile browsers.

Do not over-engineer the UI.

Prioritize usability over visual complexity.

---

# 41. NOTIFICATIONS

MVP does not require push notifications.

However, the application may implement in-app notifications if required by the existing PRD.

Do not introduce:

- Firebase Cloud Messaging
- OneSignal
- native push notification

unless explicitly required later.

---

# 42. SEARCH & FILTER

Job marketplace should support practical MVP search/filter functionality.

Examples:

- keyword
- category
- location
- distance/radius where applicable
- payment
- job status

Avoid unnecessarily complex recommendation algorithms.

---

# 43. SECURITY REQUIREMENTS

The application must protect against common vulnerabilities.

Pay particular attention to:

- IDOR
- privilege escalation
- unauthorized database access
- unauthorized storage access
- insecure direct object access
- client-side role manipulation
- client-side financial manipulation
- SQL injection
- XSS
- CSRF where applicable
- insecure file upload
- mass assignment
- race conditions
- duplicate financial transactions

Never trust values from the client for:

```text
role
user_id
status
wallet_balance
fee
total_amount
net_amount
payment_status
verification_status
```

---

# 44. FINANCIAL INTEGRITY

Financial operations require extra caution.

Before creating a wallet transaction, verify:

- authenticated user
- authorization
- related job
- assignment
- job status
- payment status
- existing transactions
- available balance

Use database transactions where multiple records must change atomically.

Prevent duplicate execution.

Where necessary, use idempotency keys or unique constraints.

---

# 45. BUSINESS RULES MUST BE SERVER-SIDE

Examples:

Incorrect:

```typescript
if (user.role === "employer") {
   // approve payment
}
```

if the role is only trusted from client state.

Correct:

- retrieve authenticated identity
- validate role from trusted database/auth context
- validate ownership
- execute server-side operation

---

# 46. NO HARDCODED BUSINESS DATA

Do not hardcode:

- categories
- platform fee
- fee payer
- admin bank account
- upload limits
- business statuses
- configurable settings

Business configuration should come from database/configuration.

---

# 47. COMPONENT DESIGN

Create reusable components.

Examples:

```text
Button
Input
Select
Modal
Dialog
DataTable
FileUploader
StatusBadge
EmptyState
LoadingState
ErrorState
MapPicker
JobCard
JobStatusBadge
PaymentStatusBadge
WalletTransactionItem
ChatMessage
```

Avoid duplicate UI implementations.

---

# 48. ROUTING

Organize routes clearly.

Possible structure:

```text
/app
  /(auth)
    /login
    /register

  /(dashboard)
    /dashboard
    /jobs
    /jobs/[id]
    /applications
    /wallet
    /withdrawals
    /chat
    /profile
    /verification

  /admin
    /...
```

Adapt this to the existing project when appropriate.

---

# 49. RESPONSIVE DESIGN

Prioritize mobile UX.

The application should be usable at:

```text
mobile
tablet
desktop
```

Do not create a separate mobile application.

This is a responsive web application.

---

# 50. TESTING

Implement tests for critical functionality.

Prioritize:

### Authentication

- register
- login
- logout
- protected route

### Authorization

- worker cannot access admin
- user cannot modify another user's job
- unverified user cannot create employer jobs

### Jobs

- create job
- publish job
- apply
- accept worker
- prevent duplicate assignment

### Payment

- upload proof
- Admin approve
- Admin reject
- prevent unauthorized approval

### Wallet

- completion creates transaction
- duplicate completion does not create duplicate income
- cannot withdraw excessive balance

### Withdrawal

- request withdrawal
- Admin processing
- Admin paid
- Admin rejected

### Chat

- participant can read/send
- non-participant cannot access conversation

---

# 51. DEVELOPMENT WORKFLOW

For every implementation phase:

### Step 1

Inspect existing implementation.

### Step 2

Compare against:

```text
PRD.md
TECHNICAL_SPEC.md
```

### Step 3

Identify missing functionality.

### Step 4

Implement database changes first.

### Step 5

Implement security/RLS.

### Step 6

Implement server-side business logic.

### Step 7

Implement UI.

### Step 8

Implement loading/error/empty states.

### Step 9

Test.

### Step 10

Review for security and authorization.

### Step 11

Only then move to the next feature.

---

# 52. MIGRATIONS

All database changes must be reproducible through migrations.

Do not manually modify production database without migration files.

Migration files must be organized and understandable.

Whenever schema changes:

1. create migration
2. update types
3. update RLS
4. update services
5. update UI
6. test

---

# 53. TYPESCRIPT

Use strong typing.

Avoid:

```typescript
any
```

unless there is a legitimate technical reason.

Prefer:

```typescript
type
interface
z.infer<typeof schema>
```

Keep database types synchronized with Supabase schema.

---

# 54. CODE QUALITY

Follow these principles:

- DRY
- SOLID where appropriate
- separation of concerns
- single responsibility
- readable naming
- small functions
- reusable services
- reusable components
- explicit business rules

Avoid:

- giant components
- giant functions
- duplicated queries
- duplicated validation
- duplicated business logic
- magic numbers
- magic strings
- unnecessary abstractions

---

# 55. ENVIRONMENT VARIABLES

Use environment variables for secrets/configuration.

Examples:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Never commit secrets.

Never expose service-role credentials to client-side code.

---

# 56. DEPLOYMENT

The application should be deployable using a standard Next.js hosting platform.

Recommended initial architecture:

```text
User
  ↓
Next.js Application
  ↓
Supabase
  ├── PostgreSQL
  ├── Auth
  ├── Storage
  └── Realtime
```

Keep infrastructure simple for MVP.

Do not introduce Kubernetes, microservices, Kafka, Redis, or unnecessary infrastructure.

---

# 57. OUT OF SCOPE

Do NOT implement these unless explicitly requested:

- native Android
- native iOS
- payment gateway
- automatic bank payout
- automated escrow
- push notifications
- rating/review
- dispute management
- AI moderation
- AI fraud detection
- automated KYC/OCR
- face recognition
- liveness detection
- social login
- multilingual system
- advanced recommendation engine
- complex analytics
- unnecessary microservices

---

# 58. HANDLING AMBIGUITY

If requirements are ambiguous:

DO NOT silently invent business rules.

Instead:

1. identify the ambiguity
2. choose the safest MVP assumption
3. document the assumption
4. keep the implementation configurable where practical

Important example:

Platform fee is currently configurable.

Do not permanently assume:

```text
10%
```

or permanently assume who pays the fee.

---

# 59. DEFINITION OF DONE

A feature is NOT complete merely because its UI exists.

A feature is complete only when:

- UI exists
- database exists
- validation exists
- authorization exists
- RLS is correct
- server-side business logic exists
- error handling exists
- loading state exists
- empty state exists where applicable
- security has been reviewed
- related transactions are atomic where required
- tests exist for critical behavior

---

# 60. IMPLEMENTATION ORDER

Implement the system in this exact general order:

## STEP 1 — Foundation

- inspect project
- configure Supabase
- establish architecture
- establish environment variables
- establish shared components

## STEP 2 — Database

Create:

- profiles
- user_roles
- employer_verifications
- job_categories
- jobs
- job_applications
- job_assignments
- attachments
- evidences
- payments
- payment_proofs
- wallets
- wallet_transactions
- withdrawals
- conversations
- participants
- messages
- notifications
- audit_logs
- platform_settings

## STEP 3 — Authentication

Implement:

- register
- login
- logout
- session
- protected routes
- profile

## STEP 4 — Roles

Implement:

- worker
- employer verification
- admin authorization

## STEP 5 — Job Marketplace

Implement:

- categories
- create job
- browse jobs
- search
- filter
- job detail
- apply
- application management
- assignment

## STEP 6 — Location

Implement:

- address
- coordinates
- map picker
- job map
- location display

## STEP 7 — Payment

Implement:

- payment instruction
- manual payment
- proof upload
- Admin verification
- payment state machine

## STEP 8 — Work Completion

Implement:

- evidence upload
- worker completion
- employer confirmation
- job completion

## STEP 9 — Wallet

Implement:

- wallet
- ledger
- job income
- platform fee
- transaction history

## STEP 10 — Withdrawal

Implement:

- withdrawal request
- Admin processing
- paid/rejected state
- audit log

## STEP 11 — Realtime Chat

Implement:

- conversation
- participants
- messages
- realtime updates
- unread state
- authorization

## STEP 12 — Admin

Implement:

- dashboard
- users
- verification
- jobs
- payments
- withdrawals
- categories
- settings
- audit logs

## STEP 13 — Security Review

Review:

- RLS
- authorization
- storage
- financial operations
- IDOR
- privilege escalation
- file uploads
- race conditions

## STEP 14 — Testing

Run:

- typecheck
- lint
- unit tests
- integration tests
- build

Fix all critical errors.

## STEP 15 — Final Review

Compare implementation against:

```text
PRD.md
TECHNICAL_SPEC.md
```

Generate an implementation checklist showing:

```text
Feature
Status
Notes
```

---

# 61. IMPORTANT DEVELOPMENT RULE

Do not say that a feature is implemented simply because:

- the page exists
- the button exists
- mock data exists
- the form submits locally
- the UI looks correct

The feature must work end-to-end.

For example:

A payment feature is NOT complete if it only displays:

```text
Upload Payment Proof
```

It must actually:

```text
Upload
→ Store securely
→ Create payment proof record
→ Change payment state
→ Notify Admin
→ Admin reviews
→ Approve/Reject
→ Update job/payment state
```

---

# 62. MOCK DATA

Mock data may be used temporarily during UI development.

However:

- clearly separate mock data
- do not ship mock data as production functionality
- replace mocks with Supabase queries before feature completion

Do not fake:

- wallet balance
- payment status
- verification status
- job assignment
- withdrawal status

---

# 63. FINAL IMPLEMENTATION REVIEW

Before declaring the MVP complete, verify:

### Authentication

- [ ] Registration
- [ ] Login
- [ ] Logout
- [ ] Session
- [ ] Protected routes

### User

- [ ] Profile
- [ ] Avatar
- [ ] Worker role
- [ ] Employer verification

### Jobs

- [ ] Categories
- [ ] Create
- [ ] Publish
- [ ] Browse
- [ ] Search
- [ ] Filter
- [ ] Detail
- [ ] Apply
- [ ] Application management
- [ ] Assignment

### Location

- [ ] Address
- [ ] Coordinates
- [ ] Map
- [ ] Location display

### Payment

- [ ] Manual payment
- [ ] Payment proof
- [ ] Admin verification
- [ ] Configurable platform fee

### Completion

- [ ] Work evidence
- [ ] Worker completion
- [ ] Employer confirmation
- [ ] Completed status

### Wallet

- [ ] Wallet
- [ ] Ledger
- [ ] Income
- [ ] Platform fee
- [ ] Transaction history

### Withdrawal

- [ ] Request
- [ ] Admin processing
- [ ] Paid
- [ ] Rejected

### Chat

- [ ] Conversation
- [ ] Participants
- [ ] Messages
- [ ] Realtime
- [ ] Authorization

### Admin

- [ ] Dashboard
- [ ] Users
- [ ] Verification
- [ ] Jobs
- [ ] Payments
- [ ] Withdrawals
- [ ] Categories
- [ ] Settings
- [ ] Audit logs

### Security

- [ ] RLS
- [ ] Authorization
- [ ] Secure storage
- [ ] Input validation
- [ ] IDOR protection
- [ ] Privilege escalation protection
- [ ] Financial integrity
- [ ] Race-condition protection

### Quality

- [ ] TypeScript passes
- [ ] Lint passes
- [ ] Tests pass
- [ ] Production build passes
- [ ] No critical console errors
- [ ] No exposed secrets
- [ ] No mock data in production flows

---

# 64. START NOW

Start by inspecting the existing project.

Do NOT immediately generate the entire application.

First return:

## PROJECT ANALYSIS

Include:

1. Current project structure
2. Existing dependencies
3. Existing Next.js architecture
4. Existing Supabase configuration
5. Existing authentication
6. Existing database/migrations
7. Existing UI/prototype
8. Existing reusable components
9. Missing implementation
10. Potential architectural problems

Then provide:

## IMPLEMENTATION PLAN

Show the exact sequence of changes you will make.

Then identify:

## DATABASE PLAN

Show:

- tables
- relationships
- indexes
- RLS strategy
- important constraints

Then identify:

## SECURITY PLAN

Show:

- authentication
- authorization
- RLS
- storage security
- financial security
- admin protection

Only after this analysis should you begin implementing.

Implement incrementally and keep the project runnable after each major phase.

Do not rewrite working code without a clear reason.

Do not silently change business requirements.

The goal is a **secure, maintainable, production-ready MVP**, not merely a functional prototype.