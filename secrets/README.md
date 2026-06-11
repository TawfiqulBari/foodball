# secrets/

File-based Docker secrets. **Nothing real in here is committed** (see `.gitignore`).

Generate the local DB password before `docker compose up`:

```bash
openssl rand -base64 32 | tr -d '\n' > secrets/db_password.txt
chmod 600 secrets/db_password.txt
```

`docker-compose.yml` mounts `db_password.txt` at `/run/secrets/db_password` and
points Postgres at it via `POSTGRES_PASSWORD_FILE` — the password never appears
in `docker inspect`, the image, the compose file, or your shell history.

Rotate by regenerating the file and recreating the `db` service.
