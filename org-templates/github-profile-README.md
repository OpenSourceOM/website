# OpenSourceOM

**Self-hosted, graph-native cloud security.** Map assets, identities, and exposures — then prioritize what attackers can actually reach.

[![OpenSourceOM console](https://raw.githubusercontent.com/OpenSourceOM/core/main/docs/assets/console.png)](https://github.com/OpenSourceOM/core)

```bash
git clone https://github.com/OpenSourceOM/core.git
cd core && cp .env.example .env && docker compose up -d
go build -o om ./cmd/om && ./om migrate && ./om scan demo && ./om rules run
open http://localhost:8080
```

## Repositories

| Repo | Description |
|------|-------------|
| **[core](https://github.com/OpenSourceOM/core)** | Platform — collectors, graph engine, CSPM rules, API, console |
| [website](https://github.com/OpenSourceOM/website) | Docs and marketing site |

## Why OpenSourceOM?

- **Graph-native** — attack path analysis, identity blast radius, exposure-aware prioritization
- **Multi-cloud** — AWS, Azure, GCP, and Kubernetes
- **Self-hosted** — run in your VPC, audit the code, Apache-2.0 licensed
- **Transparent** — no black-box risk scores

## Links

- [Website](https://opensourceom.org)
- [Getting started](https://opensourceom.org/docs/getting-started/)
- [Architecture](https://github.com/OpenSourceOM/core/blob/main/docs/ARCHITECTURE.md)
- [Roadmap](https://github.com/OpenSourceOM/core/blob/main/docs/ROADMAP.md)

## Contributing

Start with the [`core` roadmap](https://github.com/OpenSourceOM/core/blob/main/docs/ROADMAP.md) and open a discussion before large changes.

## License

Apache-2.0
