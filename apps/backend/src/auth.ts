import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { audit, transaction } from './db';
import { ApiError, requireCondition } from './errors';
import type { Role } from './contracts';

export type Actor = { id: string; email: string; role: Role; sessionId: string; mode: 'native'|'browser' };
const derive = (password: string, salt: Buffer): Promise<Buffer> => new Promise((resolve,reject) => {
  scrypt(password,salt,32,{ N: 32768, r: 8, p: 3, maxmem: 64*1024*1024 }, (error,key)=>error ? reject(error) : resolve(key));
});
const token = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password: string) {
  const salt = randomBytes(16);
  return salt.toString('hex') + ':' + (await derive(password,salt)).toString('hex');
}
async function verify(password: string, record?: string) {
  const [salt, hash] = record?.split(':') ?? [];
  // Perform the same work for an unknown email.
  const key = await derive(password, salt ? Buffer.from(salt,'hex') : Buffer.alloc(16));
  return hash ? timingSafeEqual(key,Buffer.from(hash,'hex')) : false;
}
export async function provision(pool: Pool, input: { email: string; password: string; role: Role }, actor: Actor|null) {
  const secret = await passwordHash(input.password);
  return transaction(pool,async db => {
    if (actor) await verifyActor(db,actor);
    const user = (await db.query('INSERT INTO users(email,password_hash,role) VALUES ($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id,email,role,active',
      [input.email,secret,input.role])).rows[0];
    requireCondition(user,409,'EMAIL_EXISTS','An account already exists for this email.');
    await audit(db,actor?.id??null,'USER_CREATED',null,{ role: input.role },user.id);
    return user;
  });
}
function credentials() {
  return { accessToken: token(), refreshToken: token(), tokenType: 'Bearer' as const, expiresIn: 900 };
}
export async function authenticateLogin(pool: Pool, email: string, password: string, mode: Actor['mode']) {
  const user = (await pool.query('SELECT id,email,role,password_hash,active FROM users WHERE email=$1',[email])).rows[0];
  const valid = await verify(password,user?.password_hash);
  requireCondition(valid && user?.active,401,'INVALID_CREDENTIALS','Invalid email or password.');
  const pair = credentials();
  await transaction(pool,async db => {
    const active = (await db.query('SELECT active FROM users WHERE id=$1 FOR SHARE',[user.id])).rows[0];
    requireCondition(active?.active,401,'INVALID_CREDENTIALS','Invalid email or password.');
    await db.query("INSERT INTO sessions(user_id,access_hash,refresh_hash,mode,access_expires_at,refresh_expires_at) VALUES ($1,$2,$3,$4,now()+interval '15 min',now()+interval '7 days')",
      [user.id,digest(pair.accessToken),digest(pair.refreshToken),mode]);
  });
  return pair;
}
export async function authenticate(pool: Pool, header: string | undefined): Promise<Actor> {
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? '');
  requireCondition(bearer,401,'AUTH_REQUIRED','A valid access token is required.');
  const result = await pool.query<Actor>(
    'SELECT u.id,u.email,u.role,s.id AS "sessionId",s.mode FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.access_expires_at>now() AND u.active',
    [digest(bearer[1])]);
  requireCondition(result.rows[0],401,'AUTH_REQUIRED','The access token is invalid or expired.');
  return result.rows[0];
}
export async function verifyActor(db: PoolClient, actor: Actor) {
  const user = (await db.query('SELECT active,role FROM users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];
  requireCondition(user?.active && user.role===actor.role,401,'AUTH_REQUIRED','The account can no longer perform this operation.');
  const session = (await db.query('SELECT id FROM sessions WHERE id=$1 AND revoked_at IS NULL AND access_expires_at>now() FOR SHARE',[actor.sessionId])).rows[0];
  requireCondition(session,401,'AUTH_REQUIRED','The session can no longer perform this operation.');
}
export async function refreshSession(pool: Pool, refresh: string, mode: Actor['mode']) {
  const pair = credentials();
  const changed = await pool.query<{expiresIn:number}>(
    `UPDATE sessions s SET access_hash=$1,refresh_hash=$2,access_expires_at=LEAST(now()+interval '15 min',s.refresh_expires_at)
     FROM users u WHERE s.user_id=u.id AND u.active AND s.refresh_hash=$3 AND s.mode=$4 AND s.revoked_at IS NULL AND s.refresh_expires_at>now()
     RETURNING floor(extract(epoch FROM (s.access_expires_at-now())))::integer AS "expiresIn"`,
    [digest(pair.accessToken),digest(pair.refreshToken),digest(refresh),mode]);
  if (changed.rowCount !== 1) throw new ApiError(401,'INVALID_REFRESH','The refresh credential is invalid or expired. Sign in again.');
  return { ...pair, expiresIn: changed.rows[0].expiresIn };
}
export async function revokeSession(pool: Pool, refresh: string, mode: Actor['mode']) {
  await pool.query('UPDATE sessions SET revoked_at=now() WHERE refresh_hash=$1 AND mode=$2 AND revoked_at IS NULL',[digest(refresh),mode]);
}
export async function changeAccount(pool: Pool, actor: Actor, target: string, active: boolean) {
  requireCondition(actor.id !== target,422,'SELF_CHANGE','Ask another administrator to change this account.');
  return transaction(pool,async db => {
    // Order account locks for concurrent administration, including two admins.
    await db.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[actor.id,target]]);
    await verifyActor(db,actor);
    const user = (await db.query('UPDATE users SET active=$2 WHERE id=$1 RETURNING id,email,role,active',[target,active])).rows[0];
    requireCondition(user,404,'NOT_FOUND','Account not found.');
    if (!active) await db.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[target]);
    await audit(db,actor.id,'USER_ACCESS_CHANGED',null,{ active },target);
    return user;
  });
}
