// Standalone relayer server for local development: `npm run relayer`.
import app, { CONTRACT, RELAYER_ID } from "./app.mjs";

const PORT = Number(process.env.RELAYER_PORT ?? process.env.PORT ?? 8787);
app.listen(PORT, () => console.log(`NearSeat relayer on :${PORT} → ${CONTRACT} (relayer ${RELAYER_ID})`));
