import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_ADMIN_USERNAME = process.env.DEFAULT_ADMIN_USERNAME || "admin";
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "NiwotAdmin2025!";
const DEFAULT_ADMIN_AVATAR = process.env.DEFAULT_ADMIN_AVATAR || null;

async function main() {
  // Create some default categories
  const categories = ["Culture", "Films", "Séries", "Histoire", "Géographie", "Sciences", "Sport"];
  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  // Create default admin user if not exists
  const existing = await prisma.user.findUnique({
    where: { username: DEFAULT_ADMIN_USERNAME }
  });
  if (!existing) {
    const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);
    await prisma.user.create({
      data: {
        username: DEFAULT_ADMIN_USERNAME,
        password: hash,
        role: "admin",
        profileImage: DEFAULT_ADMIN_AVATAR || undefined
      }
    });
    console.log("✅ Admin user created:", DEFAULT_ADMIN_USERNAME);
  } else {
    console.log("ℹ️ Admin user already exists");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(async () => prisma.$disconnect());
