-- Banimento de usuário, arquivo de download por produto, tema/site no Settings e histórico de downloads.
-- Tudo idempotente (IF NOT EXISTS) para não quebrar o deploy se algo já existir.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isBanned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "downloadUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "siteName" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "themeAccent" TEXT;

CREATE TABLE IF NOT EXISTS "Download" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Download_userId_idx" ON "Download"("userId");
CREATE INDEX IF NOT EXISTS "Download_productId_idx" ON "Download"("productId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Download_userId_fkey') THEN
    ALTER TABLE "Download" ADD CONSTRAINT "Download_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Download_productId_fkey') THEN
    ALTER TABLE "Download" ADD CONSTRAINT "Download_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
