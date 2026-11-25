-- Marketplace: vendedores podem cadastrar produtos próprios com a Plumify deles.
-- Tudo com IF NOT EXISTS/checagem de constraint para rodar com segurança mesmo
-- que parte já exista (consistente com as migrações anteriores do projeto).

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "storeName" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "storeBio" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plumifyApiToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plumifyOfferHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "plumifyConfigured" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sellerId" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Product_sellerId_idx" ON "Product"("sellerId");

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "sellerId" INTEGER;
CREATE INDEX IF NOT EXISTS "Order_sellerId_idx" ON "Order"("sellerId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sellerId_fkey') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Order_sellerId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
