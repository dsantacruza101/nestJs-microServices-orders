import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto';
import { NATS_SERVICE } from 'src/config';
import { catchError, firstValueFrom, throwError } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {

  private readonly logger = new Logger('OrderService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ) {
    super()
  }
  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected')
  }

  async create(createOrderDto: CreateOrderDto) {

    const productIds = createOrderDto.items.map(item => item.productId);

    const products: any[] = await firstValueFrom(this.client.send(
      { cmd: 'validate_products' },
      productIds).pipe(
        catchError(err => throwError(() => new RpcException({
          status: HttpStatus.BAD_REQUEST,
          message: 'Check Logs'
        })))
      ))

    const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {

      const price = products.find(
        (product) => product.id === orderItem.productId,
      ).price;
      return price * orderItem.quantity;
    }, 0);

    const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
      return acc + orderItem.quantity
    }, 0);

    const order = await this.order.create({
      data: {
        totalAmount: totalAmount,
        totalItems: totalItems,
        OrderItem: {
          createMany: {
            data: createOrderDto.items.map((orderItem) => ({
              price: products.find(product => product.id === orderItem.productId).price,
              productId: orderItem.productId,
              quantity: orderItem.quantity
            }))
          }
        }
      },
      include: {
        OrderItem: true
      }
    })

    return {
      ...order,
      OrderItem: order.OrderItem.map( (orderItem) => ({
        ...orderItem,
        name: products.find((product) => product.id === orderItem.productId).name,
      }))
    }

    // return this.order.create({
    //   data: createOrderDto
    // });

    // return {
    //   service: 'orders microserv',
    //   createOrderDto: createOrderDto
    // }

  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const totalPages = await this.order.count({
      where: {
        status: orderPaginationDto.status
      }
    });

    const currentPage = orderPaginationDto.page;
    const perPage = orderPaginationDto.limit;

    return {
      data: await this.order.findMany({
        skip: (currentPage - 1) * perPage,
        take: perPage,
        where: {
          status: orderPaginationDto.status
        }
      }),
      meta: {
        total: totalPages,
        page: currentPage,
        lastPage: Math.ceil(totalPages / perPage)
      }
    }
  }

  async findOne(id: string) {


    const order = await this.order.findFirst({
      where: { id }
    });

    if (!order) {
      throw new RpcException({
        status: HttpStatus.NOT_FOUND,
        message: `Order with id ${id} not found`,
      });
    }

    return order;

  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {

    const { id, status } = changeOrderStatusDto

    const order = await this.findOne(id);

    if (order.status === status) {
      return order
    }

    return await this.order.update({
      where: { id: id },
      data: { status: status }
    });

  }
}
