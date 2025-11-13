COMPOSE = docker compose -f docker-compose.yml

.PHONY: up down logs build restart

up:
	$(COMPOSE) up -d $(S)

down:
	$(COMPOSE) down $(S)

logs:
	$(COMPOSE) logs -f $(S)

build:
	$(COMPOSE) build

restart:
	$(COMPOSE) restart $(S)
