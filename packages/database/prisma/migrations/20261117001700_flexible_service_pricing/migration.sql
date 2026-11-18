CREATE TYPE "ServicePricingType" AS ENUM ('FIXED', 'RANGE', 'QUOTE_REQUIRED');

ALTER TABLE "CatalogService"
  ADD COLUMN "pricingType" "ServicePricingType" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN "minPrice" DECIMAL(12,2),
  ADD COLUMN "maxPrice" DECIMAL(12,2),
  ALTER COLUMN "unitPrice" DROP NOT NULL;

ALTER TABLE "DocumentItem" ALTER COLUMN "unitPrice" DROP NOT NULL;

ALTER TABLE "CatalogService" ADD CONSTRAINT "CatalogService_pricing_check" CHECK (
  ("pricingType" = 'FIXED'
    AND "unitPrice" IS NOT NULL AND "unitPrice" BETWEEN 0 AND 1000000
    AND "minPrice" IS NULL AND "maxPrice" IS NULL)
  OR
  ("pricingType" = 'RANGE'
    AND "unitPrice" IS NULL
    AND "minPrice" IS NOT NULL AND "maxPrice" IS NOT NULL
    AND "minPrice" BETWEEN 0 AND 1000000
    AND "maxPrice" BETWEEN "minPrice" AND 1000000)
  OR
  ("pricingType" = 'QUOTE_REQUIRED'
    AND "unitPrice" IS NULL AND "minPrice" IS NULL AND "maxPrice" IS NULL)
);
