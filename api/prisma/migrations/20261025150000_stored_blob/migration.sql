-- CreateTable
CREATE TABLE "StoredBlob" (
    "name" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredBlob_pkey" PRIMARY KEY ("name")
);
