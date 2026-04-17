FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all Python source modules
COPY *.py ./

RUN mkdir -p /app/data/reports /app/data/insights

ENV PORT=8000
# Cache HuggingFace model weights in the persistent data volume
ENV HF_HOME=/app/data/hf_cache
ENV REPORTS_DIR=/app/data/reports
ENV INSIGHTS_DIR=/app/data/insights

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
