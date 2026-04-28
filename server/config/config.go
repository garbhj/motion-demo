package config

import (
	"fmt"
	"github.com/joho/godotenv"
	"log"
	"os"
)

func InitConfig() {
	if err := godotenv.Load(); err != nil {
		log.Fatal("Error loading environment variables!")
	}

	log.Println("Successfully loaded environment variables")
}

func GetEnvVariable(v string) (string, error) {
	if v == "" {
		return "", fmt.Errorf("input param empty")
	}
	b := os.Getenv(v)
	if b == "" {
		return "", fmt.Errorf("failed to get variable for %s", v)
	}

	return b, nil

}
