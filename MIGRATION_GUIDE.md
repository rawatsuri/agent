# B2C Platform Refactoring - Migration Guide

## 🎯 Overview

The platform has been refactored from **B2B2C White-Label** to **Direct B2C** architecture.

### What Changed?

| Before (B2B2C) | After (B2C) |
|----------------|-------------|
| Business → Customer hierarchy | Direct Customer accounts |
| Clerk for business auth | Clerk for super admin + JWT for customers |
| White-label branding | No white-label |
| Multi-tenant (business isolation) | Single-tenant |
| Per-business channel gating | All customers get all channels |
| Business credits | Customer credits |

---

## 📁 Files Changed

### New Files Created
1. `src/api/auth/customer-auth.controller.ts` - Customer login/register
2. `src/middleware/customer-auth.middleware.ts` - JWT validation
3. `src/api/auth/auth.routes.ts` - Auth routes
4. `src/api/admin/admin.controller.ts` - Super admin management
5. `src/api/admin/admin.routes.ts` - Admin routes

### Modified Files
1. `prisma/schema.prisma` - New simplified schema
2. `src/routes/api.routes.ts` - Updated route structure

### Removed (To Be Deleted)
- `Business` table and all references
- `CustomBranding` table
- `CustomDomain` table
- White-label API routes
- Admin channels/tiers routes

---

## 🗄️ Database Schema Changes

### Tables Removed
- `Business`
- `BusinessCredit`
- `RateLimitConfig` (simplified)
- `AbuseLog` (simplified)
- `ResponseCache` (recreated)
- `BusinessFAQ` → `CustomerFAQ`
- `Campaign` (recreated)
- `SentimentLog` (simplified)
- `IntentLog` (simplified)
- `CRMIntegration` (removed)
- `CustomBranding` (removed)
- `CustomDomain` (removed)
- `ABTest` (removed)
- `Cohort` (removed)

### Tables Modified
- `Customer` - Added `email`, `password`, `aiConfig`
- `Conversation` - Removed `businessId`
- `CostLog` - Removed `businessId`

### Tables Created
- `Admin` - Super admin users (Clerk-based)
- `CustomerCredit` - Credits per customer

---

## 🔐 Authentication Flow

### Super Admin (Clerk)
```
Clerk Dashboard → Admin Login → Manage Customers
```

**Routes:**
- `GET/POST /api/admin/customers` - List/Create customers
- `POST /api/admin/customers/:id/credits` - Add credits
- `GET /api/admin/costs` - View all costs
- `GET /api/admin/analytics` - Dashboard analytics

### Customer (JWT)
```
Email/Password → JWT Token → Access Platform
```

**Routes:**
- `POST /api/auth/login` - Customer login
- `GET /api/auth/me` - Get profile
- `PUT /api/auth/me` - Update profile
- `POST /api/auth/change-password` - Change password

---

## 🚀 Next Steps

### 1. Database Migration

```bash
cd server
npx prisma migrate dev --name b2c_refactor
npx prisma generate
```

⚠️ **WARNING:** This will drop tables with `businessId` foreign keys. Backup your data first!

### 2. Environment Variables

Add to `.env`:
```bash
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
```

### 3. Update Services

You need to update these files to use `customerId` instead of `businessId`:

- `src/services/conversation.orchestrator.ts`
- `src/services/ai.service.ts`
- `src/channels/*/*.service.ts`
- `src/api/*/*.controller.ts`
- `src/features/cost-control/*.ts`
- `src/features/cache/*.ts`

### 4. Voice Bridge Updates

Update `voice-bridge/` to:
- Use `customerId` instead of `businessId`
- Remove multi-tenant checks
- Simplify configuration

### 5. Testing

Test these flows:
- [ ] Super admin creates customer
- [ ] Customer login/logout
- [ ] Customer accesses AI
- [ ] Voice call flow
- [ ] Cost tracking
- [ ] Admin views analytics

---

## 📊 API Endpoints Summary

### Public
```
POST /api/auth/login
POST /api/auth/register (admin only)
```

### Customer (JWT Required)
```
GET    /api/auth/me
PUT    /api/auth/me
POST   /api/auth/change-password
GET    /api/customer/*
GET    /api/analytics/*
GET    /api/conversations/*
GET    /api/campaigns/*
GET    /api/faq/*
```

### Admin (Clerk Required)
```
GET    /api/admin/customers
POST   /api/admin/customers
GET    /api/admin/customers/:id
PUT    /api/admin/customers/:id
DELETE /api/admin/customers/:id
POST   /api/admin/customers/:id/credits
GET    /api/admin/costs
GET    /api/admin/analytics
```

---

## 🔧 Configuration

### AI Per Customer
Each customer has their own AI config in `customer.aiConfig`:
```json
{
  "personality": "friendly",
  "tone": "professional",
  "customPrompts": {},
  "greeting": "Hello! How can I help?"
}
```

### Channels
All customers get all channels by default:
- VOICE (Exotel India / Twilio International)
- CHAT
- EMAIL
- SMS
- WHATSAPP
- TELEGRAM
- INSTAGRAM

### Voice Providers
- **India**: Exotel (configured globally)
- **International**: Twilio (configured globally)
- Auto-routing based on phone number country code

---

## 💰 Cost Structure

### Customer Credits
- Prepaid credit system
- Monthly budget caps
- Super admin adds credits via API

### Cost Tracking
- Every AI call tracked
- Every message tracked
- Every voice minute tracked
- Admin dashboard shows all costs

---

## 📝 Migration Checklist

- [ ] Backup existing database
- [ ] Run Prisma migration
- [ ] Update all service files
- [ ] Update voice bridge
- [ ] Test customer auth flow
- [ ] Test admin endpoints
- [ ] Test all 7 channels
- [ ] Update environment variables
- [ ] Deploy to Render
- [ ] Create first super admin in Clerk
- [ ] Create test customer
- [ ] Test voice call

---

## ⚠️ Breaking Changes

1. **All existing data will be lost** - Business-based tables are removed
2. **API routes changed** - Old business routes no longer exist
3. **Authentication changed** - JWT for customers, Clerk for admin only
4. **Database structure changed** - Cannot rollback easily

---

## 🆘 Need Help?

The major architectural changes are complete. Now you need to:
1. Update all service files to use `customerId`
2. Test each channel
3. Deploy and migrate

Would you like me to:
1. Update the service files next?
2. Update the voice bridge?
3. Create a data migration script?
4. Help with testing?
