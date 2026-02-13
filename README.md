# FindRE - Real Estate Platform Backend

Large-scale real estate platform backend built with Next.js App Router, custom authentication, and PostgreSQL (via `pg`).

## Features

- Custom authentication (JWT + refresh tokens)
- Role-based access control (RBAC)
- Permission-based access control (PBAC)
- Single role per user with direct permissions support
- Multi-language support with user language preferences
- Anonymous and authenticated session tracking (USER_SESSIONS)
- Property domain with multi-currency, multi-country support
- JSONB translations for fast multi-language queries
- Designed for 1M+ concurrent users
- Secure and scalable architecture

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp env.example .env
# Or manually copy env.example to .env
```

Fill in your PostgreSQL connection string and JWT secrets. See `env.example` for all required variables.

3. Run database migrations:
- Run `mvp.sql` against your PostgreSQL database to create all tables, indexes, triggers, and seed data

4. Run the development server:
```bash
npm run dev
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `JWT_REFRESH_SECRET` - Refresh token secret (min 32 chars)
- `JWT_ACCESS_EXPIRY` - Access token expiry (default: 15m)
- `JWT_REFRESH_EXPIRY` - Refresh token expiry (default: 7d)

## API Routes

### Authentication
- `POST /api/auth/register` - Register new user
  - Body: `{ email, password, confirmPassword, preferredLanguageCode?, sessionId? }`
  - Supports linking anonymous sessions via `sessionId`
  - Auto-detects language from `Accept-Language` header if not provided
- `POST /api/auth/login` - Login
  - Body: `{ email, password, deviceId?, sessionId? }`
  - Links anonymous session to authenticated user if `sessionId` provided
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password

### Users
- `GET /api/users/me` - Get current user (includes `preferredLanguageCode`)
- `PATCH /api/users/me` - Update current user
  - Body: `{ email?, twoFactorEnabled?, preferredLanguageCode? }`
  - Updating `preferredLanguageCode` syncs across all active sessions
- `POST /api/users/me/language-preference` - Update language preference
  - Body: `{ languageCode }` (2-character ISO code, e.g., 'en', 'ar')
  - Syncs language preference across all active user sessions
- `GET /api/users` - List users (requires permission)
- `GET /api/users/:id` - Get user by ID
- `GET /api/users/:id/permissions` - Get user permissions (role + direct permissions)

### Roles & Permissions
- `GET /api/roles` - List roles
- `GET /api/roles/:id` - Get role
- `POST /api/roles` - Create role
- `PATCH /api/roles/:id` - Update role
- `DELETE /api/roles/:id` - Delete role
- `POST /api/users/:id/roles` - Assign/replace role to user (single role per user)
- `DELETE /api/users/:id/roles` - Remove role from user
- `POST /api/users/:id/permissions/:permissionId` - Grant direct permission to user
- `DELETE /api/users/:id/permissions/:permissionId` - Revoke direct permission from user
- `GET /api/permissions` - List permissions

## Database Schema

All database schema is maintained in `mvp.sql`. This is the main schema file containing:
- Authentication & authorization tables (users, roles, permissions)
- Property domain tables (properties, agents, agencies, companies, locations, etc.)
- Multi-language support (LANGUAGES table with JSONB translations)
- Multi-currency and multi-country support
- USER_SESSIONS table for tracking both anonymous and authenticated users
- Indexes, triggers, and helper functions
- Seed data for initial setup

### Authorization Model

- **Single Role per User**: Each user has exactly one role assigned via `user_roles` table
- **Direct Permissions**: Users can have additional permissions granted directly via `user_permissions` table
- **Final Permissions**: User's effective permissions = Role permissions + Direct user permissions

### Language & Session Management

- **Language Preferences**: Users can set `preferred_language_code` (references LANGUAGES table)
- **USER_SESSIONS**: Tracks both anonymous and authenticated user sessions
  - Anonymous sessions have `user_id = NULL`
  - Sessions are linked to users on login/register via `sessionId`
  - Supports language detection and preference tracking
  - Tracks view counts and activity timestamps

### Search pipeline

Search follows this flow:

1. **User text** – Free-text query (`q`) and optional explicit params (location, beds, price, etc.).
2. **NLP / Rule parser** – `parseNaturalLanguageQuery` extracts location, beds, baths, price, features, property-type keywords; `mergeNaturalLanguageIntoState` merges into filter state (explicit params override).
3. **Structured query + filters** – `buildSearchQuery` produces full-text `q` (location + keyword); `buildFilterBy` produces Typesense `filter_by` (purpose, country, property type, beds, baths, price, area, features, etc.).
4. **Typesense** – Search runs against the `properties` collection with the built `q` and `filter_by`.
5. **Results** – Paginated hits are mapped and returned.

Endpoint: `GET /api/search` with query params (e.g. `q`, `purpose`, `location`, `bedroomsMin`, `priceMax`). See `searchQuerySchema` in `lib/security/validation.ts` for supported params.

**Filter sources (current):**
- **Location** – From `property.PROPERTIES.address` only. Typesense indexes `address` (and optional `city_en`, `area_en`, `community_en` when `property.LOCATIONS` is used). Search/filter do not rely on `property.LOCATIONS`; location is address-based full-text.
- **Features** – From `property.PROPERTY_DETAILS.features` (JSONB array of string keys, e.g. `["pool","garden"]`). Filter keys (e.g. `pool`, `ac`) must match values stored in that column. `property.FEATURES` and `property.PROPERTY_FEATURES` are not used for search/filter.

### Property Domain

- **Multi-language**: All property-related content uses JSONB translations
- **Multi-currency**: Properties support multiple currencies (AED, USD, EUR, etc.)
- **Multi-country**: Locations support multiple countries with country-specific fields
- **Agents & Agencies**: Unified AGENTS table (brokers have `agency_id`, agents have `agency_id = NULL`)
- **Property Features**: Features table with JSONB translations for amenities

## Security

- Password hashing: Argon2id
- JWT signing: HS256 (symmetric)
- Refresh token rotation on refresh
- Input validation with Zod
- SQL injection prevention (parameterized queries)
- Session tracking for security monitoring
- Anonymous user support with session-based tracking

## Deployment

Deploy to Vercel:

```bash
vercel
```

Make sure to set all environment variables in Vercel dashboard.

