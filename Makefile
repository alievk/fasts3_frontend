COMPOSE = docker compose -f docker-compose.yml

.PHONY: up down logs build

up:
	$(COMPOSE) up -d $(S)

down:
	$(COMPOSE) down $(S)

logs:
	$(COMPOSE) logs -f $(S)

build:
	$(COMPOSE) build
