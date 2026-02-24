// TypeScript types for authentication and authorization

export interface User {
  id: string;
  email: string;
  email_verified: boolean;
  two_factor_enabled: boolean;
  last_login: string | null;
  is_active: boolean;
  preferred_language_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserWithPassword extends User {
  password_hash: string;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  resource: string;
  action: string;
  description: string | null;
  created_at: string;
}

export interface UserRole {
  user_id: string;
  role_id: string;
  assigned_at: string;
  assigned_by: string | null;
}

export interface UserPermission {
  user_id: string;
  permission_id: string;
  granted_at: string;
  granted_by: string | null;
}

export interface RolePermission {
  role_id: string;
  permission_id: string;
  created_at: string;
}

export interface RefreshToken {
  id: string;
  user_id: string;
  token: string;
  device_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  session_token: string;
  expires_at: string;
  created_at: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string; // Single role
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  deviceId?: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
}

export interface EmailVerificationRequest {
  token: string;
}

export interface UserPermissions {
  userId: string;
  permissions: Permission[];
  roles: Role[];
}

export interface UserSession {
  session_id: string;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  country_code: string | null;
  language_code: string | null;
  preferred_language_code: string | null;
  first_seen_at: string;
  last_activity_at: string;
  total_views: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

