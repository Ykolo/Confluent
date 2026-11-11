/*
  Warnings:

  - Added the required column `sha256` to the `merge` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "backup" ALTER COLUMN "name" DROP NOT NULL,
ALTER COLUMN "deviceName" DROP NOT NULL,
ALTER COLUMN "backupCreatedAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "merge" ADD COLUMN     "sha256" TEXT NOT NULL,
ALTER COLUMN "fileName" DROP NOT NULL,
ALTER COLUMN "sources" DROP NOT NULL,
ALTER COLUMN "strategy" DROP NOT NULL,
ALTER COLUMN "report" DROP NOT NULL;
