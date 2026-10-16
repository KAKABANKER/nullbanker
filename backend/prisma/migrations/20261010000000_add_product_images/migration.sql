-- Galeria de fotos do produto. IF NOT EXISTS deixa a migração segura caso a
-- coluna já tenha sido criada antes (ex.: via `prisma db push`).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "images" TEXT[] DEFAULT ARRAY[]::TEXT[];
