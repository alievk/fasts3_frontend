COMPOSE = docker compose -f docker-compose.yml

.PHONY: up down logs

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f $(S)