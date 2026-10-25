// controlled_fixture: exercises the parent's failed IPC lifecycle without touching a database.
process.stderr.write('controlled_fixture child stopped before protocol completion\n');
if(process.argv[2]==='after-ready')process.send({ready:true},()=>process.exit(23));
else process.exit(17);
