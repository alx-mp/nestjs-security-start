import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1786900000000 implements MigrationInterface {
  name = 'InitialSchema1786900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "user_role" AS ENUM ('admin', 'staff', 'user')`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" text NOT NULL,
        "password_hash" text NOT NULL,
        "role" "user_role" NOT NULL DEFAULT 'user',
        "is_active" boolean NOT NULL DEFAULT true,
        "failed_login_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "user_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by_id" uuid,
        "user_agent" text,
        "ip" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_user_sessions_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "fk_user_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_user_sessions_user_id" ON "user_sessions" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_user_sessions_expires_at" ON "user_sessions" ("expires_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "user_sessions"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
  }
}
