# 使用官方 Python 镜像作为基础
FROM python:3.9-slim

# 设置工作目录
WORKDIR /code

# 复制依赖文件并安装
COPY ./requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

# 复制应用代码
COPY ./app /code/app

# 暴露端口并运行应用
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
