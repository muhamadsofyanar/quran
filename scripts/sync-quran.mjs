import { syncCorpus } from "../server/quran-store.mjs";

try {
  const result = await syncCorpus();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
