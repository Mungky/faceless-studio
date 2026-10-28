FROM alpine:3.22
ARG POCKETBASE_VERSION=0.40.6
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates curl unzip \
 && curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${TARGETARCH}.zip" -o /tmp/pb.zip \
 && unzip /tmp/pb.zip pocketbase -d /usr/local/bin \
 && rm /tmp/pb.zip \
 && addgroup -g 1000 studio && adduser -D -u 1000 -G studio studio \
 && mkdir /pb_data && chown studio:studio /pb_data
COPY infra/pocketbase/pb_migrations /pb_migrations
COPY infra/pocketbase/pb_hooks /pb_hooks
USER studio
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/pocketbase"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/pb_data", "--migrationsDir=/pb_migrations", "--hooksDir=/pb_hooks", "--automigrate=false"]
