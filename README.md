Now root dev mode runs:
npm start

That starts:

npm --prefix server run dev
npm --prefix client run dev

Server changes will restart through nodemon, and client changes will hot reload through Vite.

Production-style start is still available:

npm run build
npm run start:prod# meeting
# meeting
