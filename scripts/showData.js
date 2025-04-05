
async function main() {
  const data = await prisma.audioCache.findMany();
  console.log(data);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
