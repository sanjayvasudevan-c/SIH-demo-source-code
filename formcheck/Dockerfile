FROM python:3.11-slim
WORKDIR /app
COPY formcheck/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY shared /shared
COPY formcheck/ /app/
ENV SHARED_DIR=/shared
# Build the synthetic data and train the model so the image always has one.
RUN python training/generate.py && python training/train.py && python training/evaluate.py > /dev/null
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
