import { createHash, randomBytes } from 'node:crypto';
import type { StorageManager } from '../storage/StorageManager.js';
import type { LocalUser, UserRole } from '../../shared/types.js';

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

/**
 * Phase-1 local RBAC: salted SHA-256 passwords in the users table.
 * Phase 2 replaces this with corp OIDC — passwords are a local-machine
 * convenience, not a corporate identity.
 */
export class LocalAuth {
  private currentUser: LocalUser | null = null;

  constructor(private storage: StorageManager) {}

  userCount(): number {
    return this.storage.countUsers();
  }

  getCurrentUser(): LocalUser | null {
    return this.currentUser;
  }

  /** Roles ordered weakest→strongest for requireRole checks. */
  static roleAtLeast(role: UserRole | undefined, min: UserRole): boolean {
    if (!role) return false;
    const rank: Record<UserRole, number> = { member: 0, admin: 1, owner: 2 };
    return rank[role] >= rank[min];
  }

  hasUsers(): boolean {
    return this.storage.countUsers() > 0;
  }

  setupOwner(input: { email: string; name: string; password: string }): LocalUser {
    if (this.storage.countUsers() > 0) throw new Error('Users already exist');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${hashPassword(input.password, salt)}`;
    return this.storage.createUser({
      email: input.email,
      name: input.name,
      role: 'owner',
      passwordHash,
      createdBy: 'system',
    });
  }

  login(email: string, password: string): LocalUser | null {
    const row = this.storage.getUserByEmail(email);
    if (!row) return null;
    const [salt, hash] = row.passwordHash.split(':');
    if (!salt || hashPassword(password, salt) !== hash) return null;
    this.currentUser = row.user;
    return row.user;
  }

  logout(): void {
    this.currentUser = null;
  }

  createUser(input: { email: string; name: string; role: UserRole; password: string; createdBy?: string }): LocalUser {
    if (this.storage.getUserByEmail(input.email)) throw new Error('Email already registered');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = `${salt}:${hashPassword(input.password, salt)}`;
    return this.storage.createUser({ ...input, passwordHash });
  }

  changePassword(userId: string, newPassword: string): void {
    const salt = randomBytes(16).toString('hex');
    this.storage.updateUserPassword(userId, `${salt}:${hashPassword(newPassword, salt)}`);
  }

  listUsers(): LocalUser[] {
    return this.storage.getAllUsers();
  }

  updateRole(userId: string, role: UserRole, actor: LocalUser): void {
    const target = this.storage.getUserById(userId);
    if (!target) throw new Error('User not found');
    // Only owner can grant/revoke owner or admin roles.
    if ((role === 'owner' || role === 'admin' || target.role === 'owner' || target.role === 'admin')
        && actor.role !== 'owner') {
      throw new Error('Only the owner can manage admin/owner roles');
    }
    // Never remove the last owner.
    if (target.role === 'owner' && role !== 'owner' && this.storage.countOwners() <= 1) {
      throw new Error('Cannot demote the last owner');
    }
    this.storage.updateUserRole(userId, role);
    if (this.currentUser?.id === userId) this.currentUser = { ...this.currentUser, role };
  }

  deleteUser(userId: string, actor: LocalUser): void {
    const target = this.storage.getUserById(userId);
    if (!target) throw new Error('User not found');
    if (target.role === 'owner' || target.role === 'admin') {
      if (actor.role !== 'owner') throw new Error('Only the owner can remove admins/owners');
    }
    if (target.role === 'owner' && this.storage.countOwners() <= 1) {
      throw new Error('Cannot remove the last owner');
    }
    if (this.currentUser?.id === userId) this.currentUser = null;
    this.storage.deleteUser(userId);
  }
}
