-- College banner: rule change notices published after this are new for the user.
ALTER TABLE "User" ADD COLUMN "noticesSeenAt" TIMESTAMP(3);
