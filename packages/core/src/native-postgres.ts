import { Pool, type PoolClient } from "pg"
import { CoreDataClient, identifier, projectionColumns, type DataError, type DataResult, type DataTransport, type Predicate, type Relation, type RpcRequest, type TableRequest } from "./data-query.js"

export type DataIdentity =
  | { role: "anon" | "service_role"; id?: never; email?: never }
  | { role: "authenticated"; id: string; email?: string }

const roles = new Set(["anon", "authenticated", "service_role"])
const operators = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE" } as const
const maxRows = 1000
let pool: Pool | undefined

export function postgresPool() {
  const connectionString = process.env.SAAS_CORE_DATA_DATABASE_URL
  if (!connectionString) throw new Error("SAAS_CORE_DATA_DATABASE_URL is required for PostgreSQL data access.")
  if (!pool) {
    const connection = new URL(connectionString)
    const auth = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null
    if (!["postgres:", "postgresql:"].includes(connection.protocol) || !connection.username || (auth && connection.username === auth.username)) {
      throw new Error("Configure a dedicated PostgreSQL data login.")
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)
    if (!loopback && connection.searchParams.get("sslmode") !== "verify-full") {
      throw new Error("Remote PostgreSQL data connections require sslmode=verify-full.")
    }
    const max = Number(process.env.SAAS_CORE_DATA_POOL_MAX || 4)
    if (!Number.isInteger(max) || max < 1 || max > 16) throw new Error("Invalid PostgreSQL data pool size.")
    pool = new Pool({ connectionString, max, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000, allowExitOnIdle: true })
    pool.on("error", () => console.warn("SaaS Core idle database connection closed."))
  }
  return pool
}

const loginCheck = `
select not (r.rolsuper or r.rolbypassrls or r.rolinherit or r.rolcreaterole or r.rolcreatedb or r.rolreplication)
  and r.rolcanlogin
  and not exists (
    select from pg_catalog.pg_roles elevated
    where (elevated.rolsuper or elevated.rolbypassrls or elevated.rolcreaterole or elevated.rolcreatedb
      or elevated.rolreplication or elevated.rolname in ('neon_superuser', 'pg_read_all_data', 'pg_write_all_data'))
      and pg_catalog.pg_has_role(r.oid, elevated.oid, 'MEMBER')
  )
  and not exists (
    select from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth', 'private', 'storage', 'core_neon')
      and pg_catalog.pg_has_role(r.oid, c.relowner, 'MEMBER')
  )
  and not exists (
    select from pg_catalog.pg_auth_members m join pg_catalog.pg_roles target on target.oid = m.roleid
    where m.member = r.oid and (target.rolname not in ('anon','authenticated','service_role') or m.inherit_option or m.admin_option)
  )
  and not pg_catalog.pg_has_role('anon', 'authenticated', 'MEMBER')
  and not pg_catalog.pg_has_role('anon', 'service_role', 'MEMBER')
  and not pg_catalog.pg_has_role('authenticated', 'service_role', 'MEMBER')
  and (select count(*) from pg_catalog.pg_roles target
    where target.rolname in ('anon','authenticated','service_role')
      and not (target.rolsuper or target.rolbypassrls or target.rolcanlogin)
      and pg_catalog.pg_has_role(r.oid, target.oid, 'SET')) = 3 as allowed
from pg_catalog.pg_roles r where r.rolname = session_user`

export class NativeDataError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

function safeError(error: unknown): DataError {
  if (error instanceof NativeDataError) return { code: error.code, message: error.message }
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "CORE_DB_ERROR"
  const messages: Record<string, string> = {
    "23505": "A record with these values already exists.",
    "23503": "The referenced record does not exist or is still in use.",
    "23P01": "The operation conflicts with an existing record.",
    "42501": "Database permission denied.",
    "57014": "The database operation timed out.",
    P0001: "The database rejected the operation.",
  }
  // Existing Core and product functions use these bounded application error messages.
  if (code === "P0001" && error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)) {
    return { code, message: error.message }
  }
  return { code: /^[0-9A-Z]{5}$/.test(code) ? code : "CORE_DB_ERROR", message: messages[code] ?? "The database operation failed." }
}

async function transaction<T>(identity: DataIdentity, operation: (client: PoolClient) => Promise<DataResult<T>>): Promise<DataResult<T>> {
  let client: PoolClient | undefined
  let discard = false
  const started = performance.now()
  try {
    if (!roles.has(identity.role)) throw new NativeDataError("42501", "Invalid database role.")
    if (identity.role === "authenticated" && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(identity.id)) {
      throw new NativeDataError("42501", "A verified account is required.")
    }
    client = await postgresPool().connect()
    // These fixed setup statements use one round trip. No request data enters the batch.
    const setup = await client.query<{ allowed: boolean }>(`
      BEGIN;
      SET LOCAL statement_timeout = '8s';
      SET LOCAL idle_in_transaction_session_timeout = '12s';
      SET LOCAL search_path = pg_catalog, public;
      ${loginCheck}
    `)
    const policy = Array.isArray(setup) ? setup[setup.length - 1] : setup
    if (!policy?.rows[0]?.allowed) throw new NativeDataError("42501", "The PostgreSQL data login has unsafe privileges or missing role grants.")
    const claims = identity.role === "authenticated"
      ? { role: identity.role, sub: identity.id, email: identity.email }
      : { role: identity.role }
    // PostgreSQL applies the same SET ROLE permission checks to the role GUC.
    // Both values are bound and scoped to the open transaction.
    await client.query(
      "SELECT pg_catalog.set_config('role', $1, true), pg_catalog.set_config('request.jwt.claims', $2, true)",
      [identity.role, JSON.stringify(claims)],
    )
    const result = await operation(client)
    await client.query(result.error ? "ROLLBACK" : "COMMIT")
    return result
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK") } catch { discard = true }
    }
    return { data: null, error: safeError(error), count: null }
  } finally {
    client?.release(discard)
    if (process.env.SAAS_CORE_DATA_TIMINGS === "1") {
      console.info("SaaS Core PostgreSQL operation", { elapsedMs: Math.round(performance.now() - started) })
    }
  }
}

class Parameters {
  values: unknown[] = []
  bind(value: unknown) {
    if (value === undefined) throw new NativeDataError("22023", "Database values must be defined.")
    this.values.push(value)
    return "$" + this.values.length
  }
}

function predicates(filter: Predicate, params: Parameters): string {
  if ("all" in filter || "any" in filter) {
    const group = "all" in filter ? filter.all : filter.any
    if (!group.length) throw new NativeDataError("22023", "Database filter groups must not be empty.")
    return "(" + group.map((item) => predicates(item, params)).join("all" in filter ? " AND " : " OR ") + ")"
  }
  const column = "t." + identifier(filter.column)
  if (filter.operator === "is" || filter.operator === "isNot") {
    if (filter.value !== null && typeof filter.value !== "boolean") throw new Error("Invalid database null predicate.")
    return column + (filter.operator === "is" ? " IS " : " IS NOT ") + (filter.value === null ? "NULL" : filter.value ? "TRUE" : "FALSE")
  }
  if (filter.operator === "in") {
    return filter.value.length ? column + " IN (" + filter.value.map((value) => params.bind(value)).join(", ") + ")" : "FALSE"
  }
  if (!Object.prototype.hasOwnProperty.call(operators, filter.operator)) throw new Error("Unsupported database comparison.")
  return column + " " + operators[filter.operator] + " " + params.bind(filter.value)
}

function selectColumns(columns: string, source: string) {
  return projectionColumns(columns).map(({ column, alias }) =>
    source + "." + (column === "*" ? "*" : identifier(column)) + (alias ? " AS " + identifier(alias) : ""),
  ).join(", ")
}

async function foreignKey(client: PoolClient, source: string, relation: Relation) {
  const { rows } = await client.query<{ source_column: string; target_column: string }>(`
    SELECT a.attname AS source_column, b.attname AS target_column
    FROM pg_catalog.pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) WITH ORDINALITY keys(source, target, ord)
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.source
    JOIN pg_catalog.pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = keys.target
    WHERE c.contype = 'f' AND c.conrelid = to_regclass($1) AND c.confrelid = to_regclass($2) AND c.conname = $3
      AND (NOT $4::boolean OR EXISTS (
        SELECT FROM pg_catalog.pg_constraint u
        WHERE u.conrelid = c.conrelid AND u.contype IN ('p', 'u')
          AND u.conkey @> c.conkey AND u.conkey <@ c.conkey
      ))
    ORDER BY keys.ord
  `, [
    "public." + identifier(relation.reverse ? relation.table : source),
    "public." + identifier(relation.reverse ? source : relation.table),
    relation.foreignKey,
    relation.reverse === true,
  ])
  if (!rows.length) throw new NativeDataError("42704", "The requested to-one foreign key relation does not exist.")
  return relation.reverse ? rows.map(({ source_column, target_column }) => ({
    source_column: target_column, target_column: source_column,
  })) : rows
}

function boundedInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new NativeDataError("22023", "Invalid database pagination.")
  return value
}

async function read<T>(client: PoolClient, request: TableRequest): Promise<DataResult<T>> {
  const params = new Parameters()
  const projection = [selectColumns(request.projection ?? "*", "t")]
  const joins: string[] = []
  for (const [index, relation] of request.relations.entries()) {
    const keys = await foreignKey(client, request.table, relation)
    const tableAlias = "r" + index
    const join = [
      ...keys.map((key) => tableAlias + "." + identifier(key.target_column) + " = t." + identifier(key.source_column)),
      ...Object.entries(relation.equals ?? {}).map(([column, value]) => tableAlias + "." + identifier(column) + " = " + params.bind(value)),
    ].join(" AND ")
    const body = "SELECT " + selectColumns(relation.columns, tableAlias) + " FROM public." + identifier(relation.table) + " AS " + tableAlias + " WHERE " + join
    joins.push((relation.inner ? " JOIN" : " LEFT JOIN") + " LATERAL (" + body + ") AS " + tableAlias + " ON TRUE")
    projection.push("to_jsonb(" + tableAlias + ".*) AS " + identifier(relation.alias))
  }
  const from = " FROM public." + identifier(request.table) + " AS t" + joins.join("")
  const where = request.predicates.length ? " WHERE " + request.predicates.map((filter) => predicates(filter, params)).join(" AND ") : ""
  const statement = "SELECT " + projection.join(", ") + from + where
  let count: number | null = null
  if (request.count === "exact") {
    const result = await client.query<{ count: string }>("SELECT count(*) FROM (" + statement + ") AS counted", params.values)
    count = Number(result.rows[0].count)
  }
  if (request.head) return { data: null as T, error: null, count }
  const order = request.orders.length ? " ORDER BY " + request.orders.map((item) =>
    "t." + identifier(item.column) + (item.ascending === false ? " DESC" : " ASC") +
    (item.nullsFirst === undefined ? "" : item.nullsFirst ? " NULLS FIRST" : " NULLS LAST"),
  ).join(", ") : ""
  const max = request.cardinality ? 2 : maxRows
  const limit = params.bind(Math.min(boundedInteger(request.limit ?? max), max))
  const offset = request.offset === undefined ? "" : " OFFSET " + params.bind(boundedInteger(request.offset))
  const sql = "SELECT to_jsonb(result.*) AS value FROM (" + statement + order + " LIMIT " + limit + offset + ") AS result"
  const result = await client.query<{ value: T }>(sql, params.values)
  return shape(result.rows.map((row) => row.value), request.cardinality, count)
}

function shape<T>(values: unknown[], cardinality: TableRequest["cardinality"], count: number | null = null): DataResult<T> {
  if (cardinality) {
    if (values.length === 1) return { data: values[0] as T, error: null, count }
    if (!values.length && cardinality === "maybeSingle") return { data: null as T, error: null, count }
    return { data: null, error: { code: "PGRST116", message: "The query did not return exactly one record." }, count }
  }
  return { data: values as T, error: null, count }
}

async function primaryKey(client: PoolClient, table: string) {
  const { rows } = await client.query<{ name: string }>(`
    SELECT a.attname AS name FROM pg_catalog.pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY keys(attnum, ord)
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = keys.attnum
    WHERE c.contype = 'p' AND c.conrelid = to_regclass($1)
    ORDER BY keys.ord
  `, [table])
  return rows.map((row) => identifier(row.name))
}

async function write<T>(client: PoolClient, request: TableRequest, mutation: NonNullable<TableRequest["mutation"]>): Promise<DataResult<T>> {
  if (request.relations.length || request.orders.length || request.offset !== undefined || request.limit !== undefined || request.head || request.count) {
    throw new NativeDataError("22023", "Unsupported database write options.")
  }
  const table = "public." + identifier(request.table)
  const params = new Parameters()
  let sql: string
  if (mutation.kind === "insert" || mutation.kind === "upsert") {
    if (request.predicates.length) throw new NativeDataError("22023", "Filters are unavailable for database inserts.")
    const rows = Array.isArray(mutation.values) ? mutation.values : [mutation.values]
    if (rows.length === 0) return request.projection ? shape([], request.cardinality) : { data: null as T, error: null, count: null }
    const keys = Object.keys(rows[0]).sort()
    if (!keys.length || rows.some((row) => Object.keys(row).sort().join(",") !== keys.join(","))) {
      throw new NativeDataError("22023", "Bulk writes require the same explicit columns.")
    }
    const columns = keys.map(identifier)
    const source = "jsonb_populate_recordset(NULL::" + table + ", " + params.bind(JSON.stringify(rows)) + "::jsonb)"
    sql = "INSERT INTO " + table + " AS t (" + columns.join(", ") + ") SELECT " + columns.join(", ") + " FROM " + source
    if (mutation.kind === "upsert") {
      const conflict = mutation.options?.onConflict?.split(",").map((key) => identifier(key.trim())) ?? await primaryKey(client, table)
      if (!conflict.length) throw new NativeDataError("22023", "Upsert requires a primary key or conflict columns.")
      const updates = columns.filter((column) => !conflict.includes(column))
      sql += " ON CONFLICT (" + conflict.join(", ") + ")"
      sql += mutation.options?.ignoreDuplicates || !updates.length
        ? " DO NOTHING"
        : " DO UPDATE SET " + updates.map((column) => column + " = EXCLUDED." + column).join(", ")
    }
  } else {
    if (!request.predicates.length) throw new NativeDataError("22023", "Database updates and deletes require a filter.")
    if (mutation.kind === "update") {
      const keys = Object.keys(mutation.values)
      if (!keys.length) throw new NativeDataError("22023", "Database update requires columns.")
      const columns = keys.map(identifier)
      const source = "jsonb_populate_record(NULL::" + table + ", " + params.bind(JSON.stringify(mutation.values)) + "::jsonb)"
      sql = "UPDATE " + table + " AS t SET " + columns.map((column) => column + " = changes." + column).join(", ") + " FROM " + source + " AS changes"
    } else {
      sql = "DELETE FROM " + table + " AS t"
    }
    sql += " WHERE " + request.predicates.map((filter) => predicates(filter, params)).join(" AND ")
  }
  if (!request.projection) {
    await client.query(sql, params.values)
    return { data: null as T, error: null, count: null }
  }
  const result = await client.query<{ value: T }>(
    "WITH result AS (" + sql + " RETURNING " + selectColumns(request.projection, "t") + ") SELECT to_jsonb(result.*) AS value FROM result",
    params.values,
  )
  return shape(result.rows.map((row) => row.value), request.cardinality)
}

type Signature = { names: string[]; types: string[]; defaults: number; set: boolean }
async function rpc<T>(client: PoolClient, request: RpcRequest): Promise<DataResult<T>> {
  const name = identifier(request.routine)
  const args = new Map(Object.entries(request.args))
  const { rows } = await client.query<Signature>(`
    SELECT ARRAY(SELECT p.proargnames[i] FROM generate_series(1, cardinality(COALESCE(p.proallargtypes, p.proargtypes::oid[]))) s(i)
                 WHERE COALESCE(p.proargmodes[i], 'i') IN ('i', 'b') ORDER BY i) AS names,
           ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) WITH ORDINALITY x(t, ord) ORDER BY ord) AS types,
           p.pronargdefaults::int AS defaults, p.proretset AS set
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = $1 AND p.prokind = 'f' AND p.provariadic = 0
      AND has_function_privilege(p.oid, 'EXECUTE')
      AND EXISTS (
        SELECT FROM aclexplode(p.proacl) acl JOIN pg_catalog.pg_roles r ON r.oid = acl.grantee
        WHERE acl.privilege_type = 'EXECUTE' AND r.rolname = current_user
      )
  `, [request.routine])
  const matches = rows.filter((sig) => [...args.keys()].every((key) => sig.names.includes(key))
    && sig.names.slice(0, sig.names.length - sig.defaults).every((key) => args.has(key)))
  if (matches.length !== 1) throw new NativeDataError("42883", "The requested database function is unavailable or ambiguous.")
  const signature = matches[0]
  const params = new Parameters()
  const bound = signature.names.flatMap((key, index) => {
    if (!args.has(key)) return []
    const type = signature.types[index] // Formatted by pg_catalog from the selected input type.
    const value = args.get(key)
    const parameter = params.bind((type === "json" || type === "jsonb") && value !== null ? JSON.stringify(value) : value)
    return [identifier(key) + " => " + parameter + "::" + type]
  })
  const call = "public." + name + "(" + bound.join(", ") + ")"
  const sql = signature.set ? "SELECT to_jsonb(result.*) AS value FROM " + call + " AS result" : "SELECT to_jsonb(" + call + ") AS value"
  const result = await client.query<{ value: unknown }>(sql, params.values)
  return { data: (signature.set ? result.rows.map((row) => row.value) : result.rows[0]?.value) as T, error: null, count: null }
}

export function postgresTransport(identity: DataIdentity): DataTransport {
  return {
    table: <T>(request: TableRequest) => transaction<T>(identity, (client) =>
      request.mutation ? write<T>(client, request, request.mutation) : read<T>(client, request)),
    rpc: <T>(request: RpcRequest) => transaction<T>(identity, (client) => rpc<T>(client, request)),
  }
}

export function createNativeDataClient(identity: DataIdentity) {
  return new CoreDataClient(postgresTransport(identity))
}
