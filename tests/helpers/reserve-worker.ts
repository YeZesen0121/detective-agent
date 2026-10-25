import { BudgetBook, type Reservation } from '../../src/server/platform/budget.js';
import { openDatabase } from '../../src/server/platform/database.js';
import type { InvocationContext } from '../../src/shared/contracts.js';

const db = openDatabase(process.argv[2]!); const book = new BudgetBook(db);
process.once('message', (message: { context: InvocationContext; poolIds: string[]; reservation: Reservation }) => {
  let reserved = false;
  try { book.reserve(message.context, message.poolIds, message.reservation); reserved = true; }
  catch { /* Parent asserts the actual SQLite effect, not the error message. */ }
  db.close(); process.send?.({ reserved }); process.disconnect();
});
process.send?.({ ready: true });
